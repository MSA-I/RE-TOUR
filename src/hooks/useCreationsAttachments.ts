import { useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

export interface PipelineAttachment {
  uploadId: string;
  filename: string;
  stage: number;
}

export function useCreationsAttachments() {
  const [attachments, setAttachments] = useState<PipelineAttachment[]>([]);
  const { toast } = useToast();

  const attachToStage = useCallback((uploadId: string, filename: string, stage: number) => {
    // Remove existing attachment for this stage (only one per stage)
    setAttachments(prev => {
      const filtered = prev.filter(a => a.stage !== stage);
      return [...filtered, { uploadId, filename, stage }];
    });
    
    toast({
      title: `Attached to Stage ${stage}`,
      description: `Image will be used as input for Pipeline Stage ${stage}`
    });
  }, [toast]);

  const removeAttachment = useCallback((stage: number) => {
    setAttachments(prev => prev.filter(a => a.stage !== stage));
    toast({ title: `Removed attachment from Stage ${stage}` });
  }, [toast]);

  const clearAllAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const getAttachmentForStage = useCallback((stage: number): PipelineAttachment | undefined => {
    return attachments.find(a => a.stage === stage);
  }, [attachments]);

  return {
    attachments,
    attachToStage,
    removeAttachment,
    clearAllAttachments,
    getAttachmentForStage
  };
}
