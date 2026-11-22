// Entry: picks the source from the address, then starts the workstation.
// ?ws=link|perf|assets|capture|debug  ?theme=dark|light  ?state=unlinked|lost  ?src=replay|live
// ?session=demo|private  ?at=<picture> (open paused there)  ?bridge=<url>  ?phone=1
import './styles/tokens.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/pages.css';
import { App } from './ui/app';
import { IdleSource, ReplaySource, type Source } from './data/source';
import { LiveSource } from './data/live';
import type { PageId, Workspace } from './ui/layout';
import { setupState, type StepId } from './pages/setup';
import { desktop } from './platform/desktop';

const Q = new URLSearchParams(location.search);
const S = Q.get('session');
const demoUrl = S === 'private' && import.meta.env.DEV ? '/@private/rL.jsonl' : `${import.meta.env.BASE_URL}${S === 'long' ? 'demo-long' : 'demo-session'}.jsonl`;

async function boot(): Promise<void> {
  const root = document.getElementById('app')!;
  const at = Q.has('at') ? Number(Q.get('at')) : undefined;
  const state = Q.get('state');
  let source: Source;
  if (Q.get('src') === 'live') source = new LiveSource(Q.get('bridge') ?? 'http://127.0.0.1:52080');
  else {
    let replay: ReplaySource | null = null;
    try { replay = await ReplaySource.fromUrl(demoUrl, state === 'lost' ? { lossAt: at ?? 412 } : {}); }
    catch (e) { console.error(e); }
    if (replay && state === 'unlinked') replay.seek(replay.length); // the home shows the last session whole
    source = state === 'unlinked' || !replay ? new IdleSource(replay) : replay;
  }
  await source.start();
  if (source instanceof ReplaySource) {
    if (state === 'lost') { source.seek(0); source.play(); }
    else if (at == null) { source.seek(0); source.play(); }
  }
  const phone = Q.get('phone') === '1' || matchMedia('(max-width: 40em)').matches;
  const app = new App(root, source, { ws: (['sessions', 'settings'].includes(Q.get('ws') ?? '') ? undefined : (Q.get('ws') as Workspace)) || undefined, theme: (Q.get('theme') as 'dark' | 'light') || undefined, phone, demoUrl, bridge: Q.get('bridge') ?? undefined });
  if (at != null && state !== 'lost') { app.view.follow = false; app.view.playhead = at; app.view.bump(); }
  if (state === 'lost' && source instanceof ReplaySource) { source.seek(at ?? 412); }
  // ?setup=<step> opens Set up a console there; ?ws=sessions|settings opens a page. The desktop app opens the set-up flow on first run.
  const setup = Q.get('setup') as StepId | null; const wsq = Q.get('ws');
  if (setup) app.openSetup(setup);
  else if (wsq === 'sessions' || wsq === 'settings') app.openPage(wsq as PageId);
  else if (desktop() && !Q.has('ws') && !setupState().finished && !localStorage.getItem('qalink-cloud.setup')) app.openSetup();
  (window as unknown as { studio: App }).studio = app;
}
void boot();
