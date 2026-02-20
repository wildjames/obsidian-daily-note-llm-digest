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
        await this.processToday(true);
      }
    });

    this.addCommand({
      id: "generate-yesterday-digest-now",
      name: "Generate yesterday's digest now",
      callback: async () => {
        await this.processYesterdayIfNeeded(true);
      }
    });

    this.addCommand({
      id: "sort-daily-notes-and-summaries-now",
      name: "Sort daily notes and summaries into folders now",
      callback: async () => {
        const today = this.getLocalDateStamp(new Date());
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterday = this.getLocalDateStamp(yesterdayDate);

        await this.sortDailyNotesAndSummaries(today, yesterday);
        new Notice("Daily notes and summaries sorted");
      }
    });

    await this.processYesterdayIfNeeded(false);
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
    const everyMinutes = this.settings.checkIntervalMinutes || 60;
    const intervalId = window.setInterval(async () => {
      await this.processYesterdayIfNeeded(false);
    }, everyMinutes * 60 * 1000);

    this.registerInterval(intervalId);
  }

  private async processToday(force: boolean): Promise<void> {
    const today = this.getLocalDateStamp(new Date());
    await this.processDateIfNeeded(today, force);
  }

  private async processYesterdayIfNeeded(force: boolean): Promise<void> {
    const now = new Date();
    const today = this.getLocalDateStamp(now);
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(now.getDate() - 1);
    const yesterday = this.getLocalDateStamp(yesterdayDate);

    if (this.settings.sortDailyNotesAndSummaries) {
      await this.sortDailyNotesAndSummaries(today, yesterday);
    }

    // Have we done yesterday's notes?
    await this.processDateIfNeeded(yesterday, force);
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

      // Append the summary with a backlink to the original note
      const backlink = `\n\n---\n\n[Original note](${dateStamp})`;
      const finalContent = summary.trim() + backlink;

      await this.ensureFolderExists(this.settings.outputFolder);

      // Need to check that the directories exist before writing
      const outputDir = outputPath.split("/").slice(0, -1).join("/");
      await this.ensureFolderExists(outputDir)
      await this.app.vault.adapter.write(outputPath, finalContent.trim() + "\n");

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
    const today = this.getLocalDateStamp(new Date());
    if (this.settings.sortDailyNotesAndSummaries && dateStamp !== today) {
      const {year, month} = this.getDateParts(dateStamp);
      return normalizePath(
        `${this.settings.dailyNotesFolder}/${year}/${month}/${dateStamp}.md`
      );
    }

    return normalizePath(`${this.settings.dailyNotesFolder}/${dateStamp}.md`);
  }

  private getSummaryPath(dateStamp: string): string {
    if (this.settings.sortDailyNotesAndSummaries) {
      const yesterday = this.getYesterdayStamp();
      if (this.isDateStampBefore(dateStamp, yesterday)) {
        const {year, month} = this.getDateParts(dateStamp);
        return normalizePath(
          `${this.settings.outputFolder}/${year}/${month}/${dateStamp}_summary.md`
        );
      }
    }

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

  private getYesterdayStamp(): string {
    const now = new Date();
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(now.getDate() - 1);
    return this.getLocalDateStamp(yesterdayDate);
  }

  private getDateParts(dateStamp: string): {year: string; month: string} {
    const [year, month] = dateStamp.split("-");
    return {year, month};
  }

  private isDateStampBefore(a: string, b: string): boolean {
    return a < b;
  }

  private async sortDailyNotesAndSummaries(
    todayStamp: string,
    yesterdayStamp: string
  ): Promise<void> {
    await this.sortDailyNotes(todayStamp);
    await this.sortSummaries(yesterdayStamp);
  }

  private async sortDailyNotes(todayStamp: string): Promise<void> {
    const baseFolder = normalizePath(this.settings.dailyNotesFolder);
    if (!baseFolder || baseFolder === ".") {
      return;
    }

    const baseExists = await this.app.vault.adapter.exists(baseFolder);
    if (!baseExists) {
      return;
    }

    const listing = await this.app.vault.adapter.list(baseFolder);
    for (const filePath of listing.files) {
      const name = filePath.split("/").pop() ?? "";
      const dateStamp = this.getDailyNoteDateStamp(name);
      if (!dateStamp || dateStamp === todayStamp) {
        continue;
      }

      const {year, month} = this.getDateParts(dateStamp);
      const targetPath = normalizePath(
        `${baseFolder}/${year}/${month}/${dateStamp}.md`
      );
      if (filePath === targetPath) {
        continue;
      }

      await this.ensureFolderExists(`${baseFolder}/${year}/${month}`);
      await this.app.vault.adapter.rename(filePath, targetPath);
    }
  }

  private async sortSummaries(yesterdayStamp: string): Promise<void> {
    const baseFolder = normalizePath(this.settings.outputFolder);
    if (!baseFolder || baseFolder === ".") {
      return;
    }

    const baseExists = await this.app.vault.adapter.exists(baseFolder);
    if (!baseExists) {
      return;
    }

    const listing = await this.app.vault.adapter.list(baseFolder);
    for (const filePath of listing.files) {
      const name = filePath.split("/").pop() ?? "";
      const dateStamp = this.getSummaryDateStamp(name);
      if (!dateStamp || !this.isDateStampBefore(dateStamp, yesterdayStamp)) {
        continue;
      }

      const {year, month} = this.getDateParts(dateStamp);
      const targetPath = normalizePath(
        `${baseFolder}/${year}/${month}/${dateStamp}_summary.md`
      );
      if (filePath === targetPath) {
        continue;
      }

      await this.ensureFolderExists(`${baseFolder}/${year}/${month}`);
      await this.app.vault.adapter.rename(filePath, targetPath);
    }
  }

  private getDailyNoteDateStamp(filename: string): string | null {
    const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    return match ? match[1] : null;
  }

  private getSummaryDateStamp(filename: string): string | null {
    const match = filename.match(/^(\d{4}-\d{2}-\d{2})_summary\.md$/);
    return match ? match[1] : null;
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
        "Use {{date}} to include the date in the prompt. The daily note content will be appended to this template as a separate message when sent to the LLM."
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

    new Setting(containerEl)
      .setName("Sort daily notes and summaries")
      .setDesc(
        "Move older daily notes into yyyy/mm folders and archive summaries older than yesterday."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.sortDailyNotesAndSummaries)
          .onChange(async (value) => {
            this.plugin.settings.sortDailyNotesAndSummaries = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
