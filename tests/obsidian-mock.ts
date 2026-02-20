import {vi} from "vitest";

export const normalizePath = (value: string) =>
  value.replace(/\\/g, "/").replace(/\/+/g, "/");

export class Plugin {
  app: any;

  constructor(app: any) {
    this.app = app;
  }

  registerInterval(): void {}
  addSettingTab(): void {}
  addCommand(): void {}
  loadData(): Record<string, unknown> {
    return {};
  }
  saveData(): void {}
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl = {empty: () => {}};

  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
  }
}

export class Setting {
  constructor(_: any) {}
  setName(): this {
    return this;
  }
  setDesc(): this {
    return this;
  }
  addText(): this {
    return this;
  }
  addTextArea(): this {
    return this;
  }
  addToggle(): this {
    return this;
  }
}

export class Notice {
  message: string;

  constructor(message: string) {
    this.message = message;
  }
}

export const requestUrl = vi.fn();
export class App {}
