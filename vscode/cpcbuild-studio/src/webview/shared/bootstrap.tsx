/** bootstrap.tsx -- starts an editor webview: connects, waits for init + view, shows loading / fatal states, reports errors. */
import { Component, ComponentChildren, ComponentType, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { EditorSettings, RequestMap } from '../../shared/protocol';
import { Client } from './client';
import { ErrorState } from './components/Notice';

export interface EditorHost<R extends RequestMap<R>, V> {
  client: Client<R, V>;
  settings: EditorSettings;
  view: V;
  fileName: string;
}

const DEFAULT_SETTINGS: EditorSettings = { defaultZoom: 12, showByteGrid: true, pixelAspect: 'square' };

class Boundary extends Component<{ client: Client<any, any>; children?: ComponentChildren }, { error?: string }> {
  state: { error?: string } = {};
  componentDidCatch(e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    this.props.client.reportError(message);
    this.setState({ error: message });
  }
  render() {
    if (this.state.error === undefined) return this.props.children;
    return (
      <ErrorState
        title="The editor failed"
        message={this.state.error}
        actions={[
          { label: 'Open as text', onClick: () => void this.props.client.request('openAsText', {}) },
          { label: 'Retry', secondary: true, onClick: () => { this.setState({ error: undefined }); this.props.client.ready(); } },
        ]}
      />
    );
  }
}

function Root<R extends RequestMap<R>, V>({ client, App }: { client: Client<R, V>; App: ComponentType<EditorHost<R, V>> }) {
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);
  const [fileName, setFileName] = useState('');
  const [view, setView] = useState<V | undefined>(undefined);
  const [fatal, setFatal] = useState<string | undefined>(undefined);
  useEffect(() => {
    const off = client.subscribe((m) => {
      if (m.type === 'init') {
        setSettings(m.settings);
        setFileName(m.fileName);
      } else if (m.type === 'view') {
        setView(m.view);
        setFatal(undefined);
      } else if (m.type === 'fatal') setFatal(m.message);
    });
    client.ready();
    return off;
  }, [client]);
  // after the first paint of a view or of the fatal state (a render error unmounts this root first, so it never reports)
  const shown = view !== undefined || fatal !== undefined;
  useEffect(() => {
    if (shown) client.rendered();
  }, [client, shown]);
  if (fatal !== undefined)
    return (
      <ErrorState
        title="This file cannot be shown"
        message={fatal}
        actions={[
          { label: 'Open as text', onClick: () => void (client as Client<any, V>).request('openAsText', {}) },
          { label: 'Retry', secondary: true, onClick: () => client.ready() },
        ]}
      />
    );
  if (view === undefined) return <div class="cb-loading" role="status">Loading...</div>;
  return <App client={client} settings={settings} view={view} fileName={fileName} />;
}

export function startEditor<R extends RequestMap<R>, V>(client: Client<R, V>, App: ComponentType<EditorHost<R, V>>): void {
  window.addEventListener('error', (e) => client.reportError(e.message));
  window.addEventListener('unhandledrejection', (e) => client.reportError(String((e.reason as Error)?.message ?? e.reason)));
  const root = document.getElementById('root');
  if (!root) return client.reportError('no #root element');
  render(
    <Boundary client={client}>
      <Root client={client} App={App} />
    </Boundary>,
    root,
  );
}
