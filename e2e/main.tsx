import React from 'react';
import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import { I18nProvider } from '../app/i18n';
import '../app/globals.css';
// Synthetic-only profiling: no inputs, payloads or identities are recorded.
const metrics = { commits: 0, renderMs: 0 };
Object.assign(window, { tourMetrics: metrics });
createRoot(document.getElementById('root')!).render(<I18nProvider><React.Profiler id="home" onRender={(_id, _phase, duration) => { metrics.commits++; metrics.renderMs += duration; }}><Home /></React.Profiler></I18nProvider>);
