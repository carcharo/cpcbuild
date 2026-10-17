import * as vscode from 'vscode';
import type { Sink } from './runTool';

let channel: vscode.OutputChannel | undefined;

export function getChannel(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel('CPCBuild');
  return channel;
}

export const channelSink: Sink = { line: (t) => getChannel().appendLine(t) };

/** Writes to several sinks. */
export function tee(...sinks: Sink[]): Sink {
  return { line: (t, e) => sinks.forEach((s) => s.line(t, e)) };
}
