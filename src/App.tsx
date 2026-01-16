import MidiSampler from './components/MidiSampler';
import Metronome from './components/Metronome';
import { Badge } from './components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';

function App() {
  return (
    <div className="relative min-h-screen overflow-hidden px-6 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-28 right-[-8%] h-72 w-72 rounded-full blur-3xl opacity-70"
          style={{
            background: 'radial-gradient(circle at center, hsl(var(--accent) / 0.35), transparent 70%)',
          }}
        />
        <div
          className="absolute -bottom-32 left-[-6%] h-80 w-80 rounded-full blur-3xl opacity-60"
          style={{
            background: 'radial-gradient(circle at center, hsl(var(--primary) / 0.35), transparent 70%)',
          }}
        />
      </div>
      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header
          className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between motion-safe:animate-float-in"
          style={{ animationDelay: '40ms' }}
        >
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">Practice lab</p>
            <h1 className="font-display text-5xl sm:text-6xl leading-none">Web Drumkit</h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              Play with ultra-fast response, custom mappings, and a tempo engine built for
              focused practice sessions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Low latency</Badge>
            <Badge variant="outline">MIDI ready</Badge>
            <Badge variant="accent">Keyboard mapped</Badge>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-6">
            <div className="motion-safe:animate-float-in" style={{ animationDelay: '140ms' }}>
              <MidiSampler />
            </div>
          </div>
          <div className="space-y-6">
            <div className="motion-safe:animate-float-in" style={{ animationDelay: '220ms' }}>
              <Metronome />
            </div>
            <Card className="bg-card/85 backdrop-blur motion-safe:animate-float-in" style={{ animationDelay: '300ms' }}>
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-2xl">Session tips</CardTitle>
                <CardDescription>Quick reminders to keep the groove tight.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 rounded-full bg-accent" />
                  <p>Tap any pad once to unlock audio on first load.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 rounded-full bg-primary" />
                  <p>Toggle edit mode to customize key or MIDI bindings per pad.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 rounded-full bg-secondary" />
                  <p>Accent beats in the metronome to shape your practice feel.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
