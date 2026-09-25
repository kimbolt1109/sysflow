import React from "react";
import { render } from "ink";
import type { FlowApp } from "@/app.js";
import type { Driver } from "@/domain/drivers.js";
import type { OrchestrationMode } from "@/domain/models.js";
import type { Orchestrant } from "@/domain/orchestrator.js";
import type { PermissionMode } from "@/domain/permissions.js";
import type { ThinkingLevel } from "@/domain/thinking.js";
import { App } from "@/api/tui/App.js";

export interface TuiOpts {
  notify: boolean;
  yolo: boolean;
  permission: { current: PermissionMode };
  createAgents: (ids: string[], thinking: ThinkingLevel) => Orchestrant[];
  createDriver: (id: string, thinking?: ThinkingLevel) => Driver;
  lessons?: string;
  initialModels?: string[];
  initialMode?: OrchestrationMode;
}

export async function startTui(app: FlowApp, opts: TuiOpts): Promise<number> {
  const models = await app.refreshModels();
  const { waitUntilExit } = render(
    React.createElement(App, {
      app,
      models,
      notify: opts.notify,
      yolo: opts.yolo,
      permission: opts.permission,
      createAgents: opts.createAgents,
      createDriver: opts.createDriver,
      lessons: opts.lessons ?? "",
      initialModels: opts.initialModels,
      initialMode: opts.initialMode,
    }),
  );
  await waitUntilExit();
  return 0;
}
