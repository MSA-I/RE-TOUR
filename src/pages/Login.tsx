import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, ArrowLeft } from "lucide-react";
import logoDark from "@/assets/logo-dark-mode.png";
import logoLight from "@/assets/logo-light-mode.png";

export default function Login() {
  const { user, loading, signIn, signUp } = useAuth();
  const { theme } = useTheme();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mode, setMode] = useState<"choose" | "email-signup" | "email-signin">("choose");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/projects" replace />;
  }

  const getAuthErrorMessage = (error: unknown): string => {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    
    if (message.includes("invalid login credentials") || message.includes("invalid_credentials")) {
      return "Incorrect email or password. Please check your credentials and try again.";
    }
    if (message.includes("user already registered") || message.includes("user_already_exists")) {
      return "An account with this email already exists. Please sign in instead.";
    }
    if (message.includes("email not confirmed")) {
      return "Please verify your email before signing in.";
    }
    if (message.includes("too many requests") || message.includes("rate limit")) {
      return "Too many attempts. Please wait a moment and try again.";
    }
    
    return error instanceof Error ? error.message : "An unexpected error occurred";
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast({ title: "Please fill in all fields", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      await signIn(email.trim(), password);
      toast({ title: "Signed in successfully" });
    } catch (error) {
      const errorMessage = getAuthErrorMessage(error);
      const isWrongCredentials = errorMessage.includes("Incorrect email or password");
      
      toast({
        title: "Sign in failed",
        description: isWrongCredentials 
          ? "Incorrect email or password. Did you forget your password?" 
          : errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast({ title: "Please fill in all fields", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      await signUp(email.trim(), password);
      toast({ title: "Account created!", description: "You can now sign in with your credentials" });
      setMode("email-signin");
    } catch (error) {
      const errorMessage = getAuthErrorMessage(error);
      const isExistingUser = errorMessage.includes("already exists");
      
      toast({
        title: isExistingUser ? "Account exists" : "Sign up failed",
        description: errorMessage,
        variant: "destructive"
      });
      
      // Auto-switch to sign in if account exists
      if (isExistingUser) {
        setMode("email-signin");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    setMode("choose");
    setEmail("");
    setPassword("");
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <img src={theme === "dark" ? logoDark : logoLight} alt="RE:TOUR" className="h-24 w-auto" />
        </div>

        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-semibold text-foreground">
            {mode === "choose" && "Create your account"}
            {mode === "email-signup" && "Sign up with email"}
            {mode === "email-signin" && "Sign in"}
          </h1>
        </div>

        {/* Auth Options */}
        <div className="space-y-4">
          {mode === "choose" && (
            <>
              {/* Email Signup */}
              <Button
                variant="outline"
                className="w-full h-12 rounded-full border-border/60 bg-card hover:bg-secondary text-foreground font-medium"
                onClick={() => setMode("email-signup")}
              >
                <Mail className="h-5 w-5 mr-3" />
                Sign up with email
              </Button>

              {/* Divider */}
              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border/40" />
                </div>
              </div>

              {/* Sign In Link */}
              <p className="text-center text-muted-foreground">
                Already have an account?{" "}
                <button
                  onClick={() => setMode("email-signin")}
                  className="text-primary hover:underline font-medium"
                >
                  Sign in
                </button>
              </p>
            </>
          )}

          {mode === "email-signup" && (
            <form onSubmit={handleSignUp} className="space-y-4">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center text-muted-foreground hover:text-foreground transition-colors mb-4"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </button>

              <div className="space-y-2">
                <Label htmlFor="signup-email" className="text-muted-foreground">Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="h-12 rounded-lg bg-card border-border/60"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-password" className="text-muted-foreground">Password</Label>
                <Input
                  id="signup-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                  className="h-12 rounded-lg bg-card border-border/60"
                />
              </div>

              <Button
                type="submit"
                className="w-full h-12 rounded-full font-medium"
                disabled={isSubmitting}
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Account
              </Button>

              <p className="text-center text-muted-foreground text-sm">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("email-signin")}
                  className="text-primary hover:underline font-medium"
                >
                  Sign in
                </button>
              </p>
            </form>
          )}

          {mode === "email-signin" && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center text-muted-foreground hover:text-foreground transition-colors mb-4"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </button>

              <div className="space-y-2">
                <Label htmlFor="signin-email" className="text-muted-foreground">Email</Label>
                <Input
                  id="signin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="h-12 rounded-lg bg-card border-border/60"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="signin-password" className="text-muted-foreground">Password</Label>
                <Input
                  id="signin-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  required
                  className="h-12 rounded-lg bg-card border-border/60"
                />
              </div>

              <Button
                type="submit"
                className="w-full h-12 rounded-full font-medium"
                disabled={isSubmitting}
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign In
              </Button>

              <p className="text-center text-muted-foreground text-sm">
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("email-signup")}
                  className="text-primary hover:underline font-medium"
                >
                  Sign up
                </button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
