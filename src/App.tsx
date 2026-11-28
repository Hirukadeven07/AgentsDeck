import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AgentsDeckData } from './data/types';
import { Simulation } from './sim/simulation';
import type { Hit, LayerId, OpenTarget, RenderState } from './render';
import { AppContext, type Actions } from './components/actions';
import { DetailWindow } from './components/DetailWindow';
import { LayerToggle } from './components/LayerToggle';
import { Pager } from './components/Pager';
import { SidePanel } from './components/SidePanel';
import { Stage } from './components/Stage';
import { useMediaQuery } from './lib/useMediaQuery';
import { pageOfAgent, pageOfSkill, rackPages, rosterPages } from './render/paging';

const LAYERS: [LayerId, string][] = [
  ['axon', 'Agent floor'],
  ['skills', 'Skills layer'],
  ['roster', 'Agent roster'],
];

const isLayer = (v: string): v is LayerId => v === 'axon' || v === 'skills' || v === 'roster';
const layerFromHash = (): LayerId => {
  // no address outside a browser, such as in tests
  const h = typeof location === 'undefined' ? '' : location.hash.slice(1);
  return isLayer(h) ? h : 'axon';
};
/** True when a key press belongs to a text field, so shortcuts stay out of the way. */
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const sameTarget =(a: OpenTarget | null, b: OpenTarget) => !!a && a.type === b.type && a.id === b.id;

/**
 * `project` is the connected project's name, or undefined for the demo team. `bar` sits beside the
 * layer toggle: the connect button, or the connected project.
 */
export function App({ data, project, bar }: { data: AgentsDeckData; project?: string; bar?: ReactNode }) {
  const sim = useMemo(() => new Simulation(data), [data]);
  // follows the OS setting live, so turning on Reduce motion takes effect without a reload
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [view, setViewState] = useState<LayerId>(layerFromHash);
  const [sel, setSel] = useState(data.floorAgents[0]?.id ?? '');
  const [speed, setSpeed] = useState(1);
  const [open, setOpen] = useState<OpenTarget | null>(null);
  const [tab, setTab] = useState('overview');
  const [, setTick] = useState(0);
  const [page, setPage] = useState(0);
  // a big project shows the skills layer and the roster a page at a time
  const pages = view === 'skills' ? rackPages(data.skills) : view === 'roster' ? rosterPages(data.tiers) : 1;
  // on a new layer or project, start on the page holding whatever is open, else the first
  useEffect(() => {
    if (view === 'skills' && open?.type === 'skill') setPage(pageOfSkill(data.skills, open.id));
    else if (view === 'roster' && open?.type === 'agent') setPage(pageOfAgent(data.tiers, open.id));
    else setPage(0);
  }, [view, data, open]);
  const shownPage = Math.min(page, pages - 1);

  // the canvas reads these every frame without re-rendering React
  const stateRef = useRef<RenderState>({ sim, data, sel, open, reduce, page: shownPage });
  stateRef.current = { sim, data, sel, open, reduce, page: shownPage };
  const speedRef = useRef(speed);
  speedRef.current = speed;
  // the speed to go back to when Space resumes after a pause
  const resumeRef = useRef(1);
  if (speed > 0) resumeRef.current = speed;

  // refresh the panel and window text four times a second
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  const setView = useCallback((v: LayerId) => {
    setViewState(v);
    // on phones the bottom sheet covers the model, so switching layers closes it
    if (matchMedia('(max-width: 640px)').matches) setOpen(null);
    try {
      history.replaceState(null, '', '#' + v);
    } catch {
      /* sandboxed */
    }
  }, []);

  // name the browser tab after the layer, so a shared #skills link reads "Skills layer · AgentsDeck"
  useEffect(() => {
    const label = LAYERS.find(([id]) => id === view)?.[1];
    document.title = label ? `${label} · AgentsDeck` : 'AgentsDeck';
  }, [view]);

  useEffect(() => {
    const onHash = () => setViewState(layerFromHash());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setOpen(null);
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      // 1, 2, 3 jump to the layers in toggle order
      const layer = LAYERS[Number(e.key) - 1];
      if (layer) return setView(layer[0]);
      // Space pauses and resumes, unless a button or the window has focus (Space presses or scrolls those)
      if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        setSpeed(speedRef.current > 0 ? 0 : resumeRef.current);
      }
    };
    addEventListener('hashchange', onHash);
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('hashchange', onHash);
      removeEventListener('keydown', onKey);
    };
  }, [setView]);

  const actions: Actions = useMemo(
    () => ({
      follow: setSel,
      open: (t) => {
        setOpen((cur) => {
          if (!sameTarget(cur, t)) setTab('overview');
          return t;
        });
      },
      close: () => setOpen(null),
      setView,
    }),
    [setView],
  );

  const onTap = (target: Hit['target']) => {
    if (target.type === 'follow') actions.follow(target.id);
    else actions.open(target);
  };

  const ctx = useMemo(() => ({ data, sim, actions }), [data, sim, actions]);

  return (
    <AppContext.Provider value={ctx}>
      <div className="wrap">
        {project ? (
          <header>
            <h1>Your agents, as an office</h1>
            <p className="lede">
              Every agent and skill AgentsDeck found in <b>{project}</b>. The roster lines up the agents by level, and the skills layer holds each skill in its own rack. Tap any of
              them to see what it does. Agents will walk the floor once live activity can be connected.
            </p>
          </header>
        ) : (
          <header>
            <h1>Watch your agents work the floor</h1>
          </header>
        )}

        <div className="bar">
          <LayerToggle layers={LAYERS} value={view} onChange={setView} />
          {bar}
        </div>

        <div className="stage">
          <Stage view={view} stateRef={stateRef} speedRef={speedRef} onTap={onTap}>
            <Pager page={shownPage} pages={pages} what={view === 'skills' ? 'Skill racks' : 'Agents'} onPage={setPage} />
            {open && <DetailWindow open={open} tab={tab} onTab={setTab} />}
          </Stage>
          <SidePanel sel={sel} speed={speed} onSpeed={setSpeed} project={project} />
        </div>

        <p className="foot">
          {project
            ? `Read from ${project} in this browser. Nothing is stored on a server; this browser keeps the project until you go back to the demo.`
            : 'All agents, tickets and skills are mock data from src/data/mock. Every layer reads one shared model, so it can be wired to a real event stream later.'}
        </p>
      </div>
    </AppContext.Provider>
  );
}
