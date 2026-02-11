import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type SignedUrlResult =
  | { signedUrl: string; notFound?: false; unauthorized?: false; transient?: false }
  | { signedUrl: null; notFound?: boolean; unauthorized?: boolean; transient?: boolean; error_message?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Invoke with retry - defined outside hook for stability
async function invokeWithRetry<T>(
  fn: string,
  body: Record<string, unknown>,
  accessToken: string,
  opts?: { maxAttempts?: number; baseDelayMs?: number; timeoutMs?: number }
): Promise<{ data: T | null; error: any | null }> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 300;

  let last: { data: T | null; error: any | null } = { data: null, error: null };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 25000);

    try {
      const { data, error } = await supabase.functions.invoke(fn, {
        body,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      });

      last = { data: (data ?? null) as T | null, error };

      // Retry transient boot/network errors
      const status = (error as any)?.context?.status ?? (error as any)?.status;
      const msg = String((error as any)?.message ?? "");
      const isBoot = msg.includes("BOOT_ERROR") || msg.includes("failed to start");
      const isTransient = status === 503 || status === 504 || isBoot;

      if (error && isTransient && attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }

      return last;
    } catch (e: any) {
      // AbortError / network failure
      last = { data: null, error: e };

      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }

      return last;
    } finally {
      clearTimeout(timeout);
    }
  }

  return last;
}

export function useStorage() {
  // Cache access token to avoid repeated session lookups
  const accessTokenRef = useRef<string | null>(null);
  const tokenExpiryRef = useRef<number>(0);

  const getAccessToken = useCallback(async (): Promise<string> => {
    const now = Date.now();
    // Reuse token if not expired (with 60s buffer)
    if (accessTokenRef.current && tokenExpiryRef.current > now + 60000) {
      return accessTokenRef.current;
    }
    
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError || !session) {
      throw new Error("Not authenticated. Please log in again.");
    }
    
    accessTokenRef.current = session.access_token;
    // Token expiry from session (default to 1 hour if not available)
    tokenExpiryRef.current = session.expires_at ? session.expires_at * 1000 : now + 3600000;
    return session.access_token;
  }, []);

  const getSignedUploadUrl = useCallback(async (bucket: string, path: string, contentType: string) => {
    const accessToken = await getAccessToken();

    const { data, error } = await invokeWithRetry<any>(
      "create-signed-upload-url",
      { bucket, path, contentType },
      accessToken,
      { timeoutMs: 20000 }
    );

    if (error) {
      console.error("Edge function error:", error);
      throw new Error(error.message || "Failed to get upload URL");
    }

    if ((data as any)?.error) {
      throw new Error((data as any).error);
    }

    return data;
  }, [getAccessToken]);

  // Get signed view URL - supports both uploadId (preferred) and bucket+path (legacy)
  const getSignedViewUrl = useCallback(async (
    bucketOrUploadId: string, 
    path?: string, 
    expiresIn = 3600
  ): Promise<SignedUrlResult> => {
    const accessToken = await getAccessToken();

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    // Detect uploadId mode:
    // 1. Single UUID arg (no path)
    // 2. OR path arg is actually a UUID (common mistake: passing uploadId as path)
    const firstArgIsUuid = UUID_REGEX.test(bucketOrUploadId);
    const secondArgIsUuid = path && UUID_REGEX.test(path);
    
    // If second arg is a UUID, treat it as the uploadId (fix common misuse pattern)
    // If first arg is UUID and no second arg, use first arg as uploadId
    const isUploadIdMode = (!path && firstArgIsUuid) || secondArgIsUuid;
    const resolvedUploadId = secondArgIsUuid ? path : (firstArgIsUuid && !path ? bucketOrUploadId : null);
    
    const body = isUploadIdMode && resolvedUploadId
      ? { uploadId: resolvedUploadId, expiresIn }
      : { bucket: bucketOrUploadId, path, expiresIn };

    const { data, error } = await invokeWithRetry<any>(
      "create-signed-view-url",
      body,
      accessToken,
      { timeoutMs: 20000 }
    );

    // Edge function may return 403/404/etc. as an error object. Never throw here — callers should not crash.
    if (error) {
      const status = (error as any)?.context?.status ?? (error as any)?.status;
      const msg = String((error as any)?.message ?? "");

      // Transient boot errors: treat as retryable and return null (UI can show placeholder)
      if (status === 503 || msg.includes("BOOT_ERROR") || msg.includes("failed to start")) {
        return { signedUrl: null, transient: true, error_message: "Temporary backend issue. Please retry." };
      }

      // Ownership / missing upload row
      if (status === 403) {
        return { signedUrl: null, unauthorized: true, error_message: "File not found or unauthorized" };
      }

      return { signedUrl: null, error_message: msg || "Failed to load file" };
    }

    if ((data as any)?.error) {
      return { signedUrl: null, error_message: (data as any).error };
    }

    if ((data as any)?.notFound) {
      return { signedUrl: null, notFound: true };
    }

    if (!(data as any)?.signedUrl) {
      return { signedUrl: null, error_message: "No signed URL returned" };
    }

    return { signedUrl: (data as any).signedUrl };
  }, [getAccessToken]);

  const getSignedDownloadUrl = useCallback(async (bucketOrUploadId: string, path: string, filename?: string, expiresIn = 3600) => {
    const accessToken = await getAccessToken();

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    // Detect uploadId mode same as getSignedViewUrl
    const firstArgIsUuid = UUID_REGEX.test(bucketOrUploadId);
    const secondArgIsUuid = path && UUID_REGEX.test(path);
    
    const isUploadIdMode = (!path && firstArgIsUuid) || secondArgIsUuid || bucketOrUploadId === "lookup";
    const resolvedUploadId = bucketOrUploadId === "lookup" 
      ? path 
      : (secondArgIsUuid ? path : (firstArgIsUuid && !path ? bucketOrUploadId : null));
    
    const body = isUploadIdMode && resolvedUploadId
      ? { uploadId: resolvedUploadId, expiresIn, filename }
      : { bucket: bucketOrUploadId, path, expiresIn, filename };

    const { data, error } = await invokeWithRetry<any>(
      "create-signed-download-url",
      body,
      accessToken,
      { timeoutMs: 20000 }
    );

    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    return data;
  }, [getAccessToken]);

  const uploadFile = useCallback(async (bucket: string, path: string, file: File) => {
    console.log(`[useStorage] Starting upload: bucket=${bucket}, path=${path}, type=${file.type}, size=${file.size}`);

    let uploadUrlData;
    try {
      uploadUrlData = await getSignedUploadUrl(bucket, path, file.type);
      console.log("[useStorage] Got signed URL data:", {
        hasSignedUrl: !!uploadUrlData?.signedUrl,
        hasToken: !!uploadUrlData?.token,
        path: uploadUrlData?.path
      });
    } catch (error) {
      console.error("[useStorage] Failed to get signed URL:", error);
      throw error;
    }

    const { signedUrl, token, path: returnedPath } = uploadUrlData;

    if (!signedUrl) {
      console.error("[useStorage] Missing signedUrl in response");
      throw new Error("Invalid upload URL response: missing signedUrl");
    }

    console.log("[useStorage] Uploading file to Supabase Storage...");

    // Use the signed URL exactly as returned - it includes all necessary auth
    const response = await fetch(signedUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Cache-Control": "3600",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[useStorage] Upload failed:", {
        status: response.status,
        statusText: response.statusText,
        errorText,
        contentType: file.type,
        fileSize: file.size,
      });
      throw new Error(`Failed to upload file: ${response.status} - ${errorText || response.statusText}`);
    }

    console.log("[useStorage] Upload successful");
    return { path: returnedPath || path, token };
  }, [getSignedUploadUrl]);

  return {
    getSignedUploadUrl,
    getSignedViewUrl,
    getSignedDownloadUrl,
    uploadFile,
  };
}
