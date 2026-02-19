import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  normalizePath,
  requestUrl
} from "obsidian";
import {DailyNotesDigestSettings, DEFAULT_SETTINGS} from "./settings";

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

export default class DailyNotesDigestPlugin extends Plugin {
  settings!: DailyNotesDigestSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new DailyNotesDigestSettingTab(this.app, this));

    this.addCommand({
      id: "generate-today-digest-now",
      name: "Generate today's digest now",
      callback: async () => {
        await this.processTodayIfNeeded(true);
      }
    });

    await this.processTodayIfNeeded(false);
    this.scheduleDailyCheck();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // Heartbeat
  private scheduleDailyCheck(): void {
    const everyMinutes = Math.max(this.settings.checkIntervalMinutes || 60);
    const intervalId = window.setInterval(async () => {
      await this.processTodayIfNeeded(false);
    }, everyMinutes * 60 * 1000);

    this.registerInterval(intervalId);
  }

  private async processTodayIfNeeded(force: boolean): Promise<void> {
    const now = new Date();
    const today = this.getLocalDateStamp(now);
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(now.getDate() - 1);
    const yesterday = this.getLocalDateStamp(yesterdayDate);

    // Have we done yesterday's notes?
    await this.processDateIfNeeded(yesterday, force);

    // Is it time to do today's notes?
    const isAfterCutoff = now.getHours() >= 22;
    if (force || isAfterCutoff) {
      await this.processDateIfNeeded(today, force);
    }
  }

  private async processDateIfNeeded(dateStamp: string, force: boolean): Promise<void> {
    const outputPath = this.getSummaryPath(dateStamp);
    if (!force) {
      const summaryExists = await this.app.vault.adapter.exists(outputPath);
      if (summaryExists) {
        return;
      }
    }

    try {
      const dailyNotePath = this.getDailyNotePath(dateStamp);
      const exists = await this.app.vault.adapter.exists(dailyNotePath);

      if (!exists) {
        if (force) {
          new Notice(`Daily note not found: ${dailyNotePath}`);
        }
        return;
      }

      const noteContents = (await this.app.vault.adapter.read(dailyNotePath)).trim();
      if (!noteContents || noteContents.length < 20) {
        if (force) {
          new Notice(`Daily note is empty or nearly empty: ${dailyNotePath}`);
        }
        return;
      }
      const messages = this.buildMessages(dateStamp, noteContents);
      const summary = await this.callLlm(messages);

      if (!summary) {
        new Notice("LLM returned an empty summary");
        return;
      }

      await this.ensureFolderExists(this.settings.outputFolder);
      await this.app.vault.adapter.write(outputPath, summary.trim() + "\n");

      this.settings.lastProcessedDate = dateStamp;
      await this.saveSettings();

      new Notice(`Daily summary saved: ${outputPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to generate daily summary", error);
      new Notice(`Daily summary failed: ${message}`);
    }
  }

  private getDailyNotePath(dateStamp: string): string {
    return normalizePath(`${this.settings.dailyNotesFolder}/${dateStamp}.md`);
  }

  private getSummaryPath(dateStamp: string): string {
    return normalizePath(`${this.settings.outputFolder}/${dateStamp}_summary.md`);
  }

  private buildMessages(dateStamp: string, note: string): ChatMessage[] {
    const instructionContent = this.settings.promptTemplate
      .replaceAll("{{date}}", dateStamp);

    return [
      {role: "system", content: instructionContent},
      {
        role: "user",
        content: `Daily note for ${dateStamp}:\n\n${note}`
      }
    ];
  }

  private async callLlm(messages: ChatMessage[]): Promise<string> {
    if (!this.settings.llmEndpoint.trim()) {
      throw new Error("LLM endpoint is empty");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (this.settings.apiKey.trim()) {
      headers.Authorization = `Bearer ${this.settings.apiKey.trim()}`;
    }

    const response = await requestUrl({
      method: "POST",
      url: this.settings.llmEndpoint,
      headers,
      body: JSON.stringify({
        model: this.settings.model,
        messages,
        temperature: 0.2
      })
    });

    if (response.status !== 200) {
      throw new Error(`LLM request failed (${response.status})`);
    }

    const content = response.json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Unexpected LLM response shape");
    }

    return content;
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    if (!normalized || normalized === ".") {
      return;
    }

    const exists = await this.app.vault.adapter.exists(normalized);
    if (exists) {
      return;
    }

    // If the path doesnt exist, create it segment by segment
    const parts = normalized.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const segmentExists = await this.app.vault.adapter.exists(current);
      if (!segmentExists) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private getLocalDateStamp(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}

class DailyNotesDigestSettingTab extends PluginSettingTab {
  plugin: DailyNotesDigestPlugin;

  constructor(app: App, plugin: DailyNotesDigestPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const {containerEl} = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Daily notes folder")
      .setDesc("Folder containing daily notes named yyyy-mm-dd.md")
      .addText((text) =>
        text
          .setPlaceholder("Daily")
          .setValue(this.plugin.settings.dailyNotesFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesFolder = value.trim() || "Daily";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Summary output folder")
      .setDesc("Folder where yyyy-mm-dd_summary.md files are written")
      .addText((text) =>
        text
          .setPlaceholder("Daily Summaries")
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = value.trim() || "Daily Summaries";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("LLM endpoint")
      .setDesc("OpenAI-compatible chat completions endpoint")
      .addText((text) =>
        text
          .setPlaceholder("https://api.openai.com/v1/chat/completions")
          .setValue(this.plugin.settings.llmEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.llmEndpoint = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Authorization key for your LLM provider")
      .addText((text) =>
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Model name sent in the request body")
      .addText((text) =>
        text
          .setPlaceholder("gpt-4o-mini")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim() || "gpt-4o-mini";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Summary prompt template")
      .setDesc(
        "Use {{date}}. {{note}} is optional for legacy templates and replaced with guidance because note content is sent separately."
      )
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.promptTemplate)
          .onChange(async (value) => {
            this.plugin.settings.promptTemplate = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Check interval (minutes)")
      .setDesc("Plugin checks periodically and only processes once per day")
      .addText((text) =>
        text
          .setPlaceholder("60")
          .setValue(String(this.plugin.settings.checkIntervalMinutes))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.checkIntervalMinutes = Number.isFinite(parsed)
              ? Math.max(5, parsed)
              : 60;
            await this.plugin.saveSettings();
          })
      );
  }
}
