import { ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Image, Play, CheckCircle, FolderOpen, User, HelpCircle, 
  ChevronDown, Menu, Send, Loader2, MessageCircle, Wand2, Layers, Box,
  Sun, Moon
} from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";
import logoDark from "@/assets/logo-dark-mode.png";
import logoLight from "@/assets/logo-light-mode.png";
import { supabase } from "@/integrations/supabase/client";

interface AppLayoutProps {
  children: ReactNode;
  projectId?: string;
  onNavigate?: (tab: string) => void;
  pageTitle?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function AppLayout({ children, projectId, onNavigate, pageTitle }: AppLayoutProps) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "How can I help you navigate RE:TOUR? Ask me about uploading images, running renders, or any feature!" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Sign out failed:", error);
    }
  };

  const handleNavClick = (tabValue: string) => {
    if (onNavigate) {
      onNavigate(tabValue);
    }
  };

  const panoramaNavItems = projectId ? [
    { title: "Panorama Uploads", icon: Image, tabValue: "panorama-uploads" },
    { title: "Panorama Render Jobs", icon: Play, tabValue: "panorama-jobs" },
    { title: "Edited Images", icon: CheckCircle, tabValue: "edited-images" },
  ] : [];

  const floorPlanNavItems = projectId ? [
    { title: "Floor Plan Uploads", icon: Image, tabValue: "floor-plan-uploads" },
    { title: "2D→3D Jobs (Pipelines)", icon: Play, tabValue: "floor-plan-jobs" },
  ] : [];

  const creativeNavItems = projectId ? [
    { title: "Virtual Tour", icon: Box, tabValue: "virtual-tour" },
    { title: "Multi Panoramas", icon: Layers, tabValue: "multi-image-panorama" },
    { title: "Creations", icon: Layers, tabValue: "creations" },
    { title: "Image Editing", icon: Wand2, tabValue: "image-editing" },
    { title: "Edit Jobs", icon: CheckCircle, tabValue: "image-editing-jobs" },
  ] : [];

  const globalNavItems = [
    { title: "Projects", icon: FolderOpen, path: "/projects" },
  ];

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isSending) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setIsSending(true);

    try {
      const { data, error } = await supabase.functions.invoke("help-chatbot", {
        body: { message: userMessage }
      });

      if (error) throw error;

      setChatMessages(prev => [...prev, { 
        role: "assistant", 
        content: data.response || "I'm sorry, I couldn't process that. Please try again." 
      }]);
    } catch (error) {
      console.error("Chat error:", error);
      setChatMessages(prev => [...prev, { 
        role: "assistant", 
        content: "Sorry, I'm having trouble connecting. Please try again in a moment." 
      }]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col w-full bg-background">
      {/* Top Header */}
      <header className="border-b border-border/50 bg-card/95 backdrop-blur sticky top-0 z-50">
        <div className="px-4 py-3 flex items-center justify-between">
          {/* Left: Logo + Page Title */}
          <div className="flex items-center gap-4">
            <Link to="/projects" className="flex items-center gap-2">
              <img 
                src={theme === "dark" ? logoDark : logoLight} 
                alt="RE:TOUR" 
                className="h-8 w-auto" 
              />
              <span className="text-lg font-semibold">RE:TOUR</span>
            </Link>
            {pageTitle && (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="text-sm font-medium text-muted-foreground">{pageTitle}</span>
              </>
            )}
          </div>

          {/* Center: Navigation Dropdown (only when in project) */}
          <div className="flex items-center gap-2">
            {(panoramaNavItems.length > 0 || floorPlanNavItems.length > 0 || creativeNavItems.length > 0) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2">
                    <Menu className="h-4 w-4" />
                    Navigation
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-56">
                  {panoramaNavItems.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                        Panoramas
                      </div>
                      {panoramaNavItems.map((item) => (
                        <DropdownMenuItem 
                          key={item.title}
                          onClick={() => handleNavClick(item.tabValue)}
                          className="cursor-pointer"
                        >
                          <item.icon className="h-4 w-4 mr-2" />
                          {item.title}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                  {floorPlanNavItems.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                        Floor Plans (2D→3D)
                      </div>
                      {floorPlanNavItems.map((item) => (
                        <DropdownMenuItem 
                          key={item.title}
                          onClick={() => handleNavClick(item.tabValue)}
                          className="cursor-pointer"
                        >
                          <item.icon className="h-4 w-4 mr-2" />
                          {item.title}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                  {creativeNavItems.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                        Creative Tools
                      </div>
                      {creativeNavItems.map((item) => (
                        <DropdownMenuItem 
                          key={item.title}
                          onClick={() => handleNavClick(item.tabValue)}
                          className="cursor-pointer"
                        >
                          <item.icon className="h-4 w-4 mr-2" />
                          {item.title}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                  <DropdownMenuSeparator />
                  {globalNavItems.map((item) => (
                    <DropdownMenuItem 
                      key={item.title}
                      onClick={() => navigate(item.path)}
                      className="cursor-pointer"
                    >
                      <item.icon className="h-4 w-4 mr-2" />
                      {item.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleTheme}
                  className="p-2 hover:bg-muted rounded-lg transition-colors"
                  aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                >
                  {theme === "dark" ? (
                    <Sun className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <Moon className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </TooltipContent>
            </Tooltip>
            
            <NotificationBell />
            <button 
              className="p-2 hover:bg-muted rounded-lg transition-colors"
              onClick={() => setHelpOpen(true)}
            >
              <HelpCircle className="h-5 w-5 text-muted-foreground" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-muted/80 rounded-full transition-colors">
                  <span className="text-sm font-medium">My Profile</span>
                  <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {/* Panoramas Navigation */}
                {panoramaNavItems.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Panoramas
                    </div>
                    {panoramaNavItems.map((item) => (
                      <DropdownMenuItem 
                        key={item.title}
                        onClick={() => handleNavClick(item.tabValue)}
                        className="cursor-pointer"
                      >
                        <item.icon className="h-4 w-4 mr-2" />
                        {item.title}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                {/* Floor Plans Navigation */}
                {floorPlanNavItems.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Floor Plans (2D→3D)
                    </div>
                    {floorPlanNavItems.map((item) => (
                      <DropdownMenuItem 
                        key={item.title}
                        onClick={() => handleNavClick(item.tabValue)}
                        className="cursor-pointer"
                      >
                        <item.icon className="h-4 w-4 mr-2" />
                        {item.title}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                {/* Creative Tools Navigation */}
                {creativeNavItems.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Creative Tools
                    </div>
                    {creativeNavItems.map((item) => (
                      <DropdownMenuItem 
                        key={item.title}
                        onClick={() => handleNavClick(item.tabValue)}
                        className="cursor-pointer"
                      >
                        <item.icon className="h-4 w-4 mr-2" />
                        {item.title}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                <DropdownMenuSeparator />
                {globalNavItems.map((item) => (
                  <DropdownMenuItem 
                    key={item.title}
                    onClick={() => navigate(item.path)}
                    className="cursor-pointer"
                  >
                    <item.icon className="h-4 w-4 mr-2" />
                    {item.title}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                {/* Account Section */}
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Account
                </div>
                <DropdownMenuItem className="text-muted-foreground text-sm">
                  {user?.email}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSignOut}>
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Help Chatbot Dialog */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              Help & Support
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col h-[400px]">
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-4 pb-4">
                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {isSending && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg px-3 py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
            <div className="flex gap-2 pt-4 border-t">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about site features..."
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                disabled={isSending}
              />
              <Button size="icon" onClick={handleSendMessage} disabled={isSending || !chatInput.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
