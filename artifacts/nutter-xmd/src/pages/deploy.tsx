import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Github, Rocket, Search, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";
import { useVerifyFork, ApiError, getVerifyForkQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const formSchema = z.object({
  username: z.string().min(1, { message: "GitHub username is required" }),
});

const REQUIREMENTS = [
  { icon: "🔑", label: "SESSION_ID from the Pairing page" },
  { icon: "📱", label: "Owner WhatsApp number (international format)" },
  { icon: "☁️", label: "A free or hobby Heroku account" },
  { icon: "🍴", label: "A fork of the Nutter-MD repository" },
];

const STEPS = [
  { n: "01", title: "Fork the repo", body: "Go to the Nutter-MD GitHub repository and click Fork. This gives you your own copy to deploy." },
  { n: "02", title: "Get your Session ID", body: "Head to the Pairing page, enter your WhatsApp number and get your pair code. Copy the SESSION_ID." },
  { n: "03", title: "Verify & deploy", body: "Enter your GitHub username below to verify your fork, then click Deploy to Heroku. Fill in SESSION_ID and OWNER_NUMBER when prompted." },
];

export function DeployPage() {
  const [username, setUsername] = useState<string | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { username: "" },
  });

  const verifyParams = { username: username || "" };
  const { data: verificationData, isLoading, isError, error } = useVerifyFork(
    verifyParams,
    { query: { enabled: !!username, retry: false, queryKey: getVerifyForkQueryKey(verifyParams) } }
  );

  function onSubmit(values: z.infer<typeof formSchema>) {
    setUsername(values.username);
  }

  const forkVerified = !!(verificationData?.forked);

  return (
    <div className="flex-1 flex flex-col gap-10 w-full max-w-2xl mx-auto">

      {/* ── Top: NUTTER-XMD Description ─────────────────────────────────────── */}
      <div className="flex flex-col gap-8 pt-2">
        <div className="space-y-4">
          <div className="text-6xl select-none leading-none">🇰🇪</div>
          <div>
            <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight">
              Deploy<span className="text-primary"> Your Bot</span>
            </h1>
            <p className="mt-3 text-muted-foreground text-base lg:text-lg leading-relaxed">
              Get your own NUTTER-XMD instance running on Heroku in under 5 minutes — no coding required.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">What you'll need</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {REQUIREMENTS.map((r) => (
              <li key={r.label} className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="text-base shrink-0">{r.icon}</span>
                {r.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4 pt-2 border-t border-border/40">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">How it works</p>
          <ol className="space-y-4">
            {STEPS.map((s) => (
              <li key={s.n} className="flex gap-3">
                <span className="font-mono text-xs text-primary/60 pt-0.5 shrink-0">{s.n}</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">{s.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* ── Bottom: Action cards (input fields / deploy) ────────────────────── */}
      <div className="space-y-5">

        {/* Card 1 — Verify fork */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-primary font-bold text-sm shrink-0">1</div>
              <div>
                <CardTitle className="text-lg">Verify Your Fork</CardTitle>
                <CardDescription className="mt-0.5">You must fork Nutter-MD before deploying</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex gap-3">
                <FormField control={form.control} name="username" render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <div className="relative">
                        <Github className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Your GitHub username" className="pl-9 bg-background/50" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? <Search className="h-4 w-4 animate-bounce" /> : "Verify"}
                </Button>
              </form>
            </Form>

            {username && isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
                <Search className="h-4 w-4" /> Checking GitHub…
              </div>
            )}

            {username && isError && (
              <Alert variant="destructive" className="bg-destructive/10 border-destructive/20">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Verification Failed</AlertTitle>
                <AlertDescription>
                  {error instanceof ApiError ? error.message : "Could not verify your GitHub account. Please try again."}
                </AlertDescription>
              </Alert>
            )}

            {verificationData && !verificationData.forked && (
              <Alert variant="destructive" className="bg-destructive/10 border-destructive/20">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Fork Not Found</AlertTitle>
                <AlertDescription className="space-y-3 mt-1">
                  <p>User <strong>{verificationData.username}</strong> has not forked Nutter-MD yet.</p>
                  <Button variant="outline" size="sm" asChild className="border-destructive/30 hover:bg-destructive/20">
                    <a href="https://github.com/nutterxtech/Nutter-MD" target="_blank" rel="noreferrer">
                      <Github className="mr-2 h-4 w-4" /> Fork on GitHub
                    </a>
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {forkVerified && (
              <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-green-500 text-sm">Fork Verified</p>
                  <a href={verificationData?.forkUrl || "#"} target="_blank" rel="noreferrer"
                    className="text-xs text-green-500/80 underline underline-offset-4 hover:text-green-400 mt-0.5 block">
                    {verificationData?.forkUrl}
                  </a>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 2 — Deploy */}
        <Card className={`border-border/50 bg-card/50 backdrop-blur-sm transition-all duration-300 ${!forkVerified ? "opacity-40 grayscale select-none pointer-events-none" : ""}`}>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-primary font-bold text-sm shrink-0">2</div>
              <div>
                <CardTitle className="text-lg">Deploy to Heroku</CardTitle>
                <CardDescription className="mt-0.5">Launch your forked bot in one click</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <Alert className="bg-primary/5 border-primary/20">
              <AlertCircle className="h-4 w-4 text-primary" />
              <AlertTitle className="text-primary text-sm">Before you click</AlertTitle>
              <AlertDescription className="text-primary/80 text-xs mt-1">
                Have your <strong>SESSION_ID</strong> ready — get it from the Pairing page first. You'll also need your <strong>OWNER_NUMBER</strong> in international format (e.g. 254712345678).
              </AlertDescription>
            </Alert>

            <Button size="lg" className="w-full font-bold h-14 text-base bg-[#430098] hover:bg-[#430098]/90 text-white border-0" asChild>
              <a
                href={verificationData?.deployUrl || `https://heroku.com/deploy?template=https://github.com/${username}/Nutter-MD`}
                target="_blank"
                rel="noreferrer"
              >
                <Rocket className="mr-2 h-5 w-5" />
                Deploy to Heroku
                <ArrowRight className="ml-2 h-4 w-4 opacity-60" />
              </a>
            </Button>
          </CardContent>
        </Card>

        {/* Card 3 — After deploy tip */}
        <Card className="border-border/30 bg-card/30 backdrop-blur-sm">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-start gap-3">
              <span className="text-xl shrink-0">💡</span>
              <div className="space-y-1">
                <p className="text-sm font-semibold">After deployment</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Once Heroku finishes building, your bot will connect to WhatsApp automatically and send a welcome message to your number. If it doesn't respond within 2 minutes, check the Heroku logs for errors.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
