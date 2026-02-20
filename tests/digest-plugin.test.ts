import {beforeEach, describe, expect, it, vi} from "vitest";
import {requestUrl} from "obsidian";
import DailyNotesDigestPlugin from "../src/main";
import {DEFAULT_SETTINGS} from "../src/settings";

const createPlugin = () => {
  const app = {
    vault: {
      adapter: {
        exists: vi.fn(),
        read: vi.fn(),
        write: vi.fn()
      },
      createFolder: vi.fn()
    }
  };

  const plugin = new DailyNotesDigestPlugin(app as any, {} as any);
  plugin.settings = {
    ...DEFAULT_SETTINGS
  };

  return {app, plugin};
};

describe("DailyNotesDigestPlugin helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats local date stamps", () => {
    const {plugin} = createPlugin();
    const stamp = (plugin as any).getLocalDateStamp(new Date("2026-02-03T10:00:00"));
    expect(stamp).toBe("2026-02-03");
  });

  it("builds chat messages with date substitution", () => {
    const {plugin} = createPlugin();
    plugin.settings.promptTemplate = "Digest for {{date}}";

    const messages = (plugin as any).buildMessages("2026-02-20", "Line one\nLine two");

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: "system",
      content: "Digest for 2026-02-20"
    });
    expect(messages[1].content).toContain("Daily note for 2026-02-20");
    expect(messages[1].content).toContain("Line one");
  });

  it("throws when LLM endpoint is empty", async () => {
    const {plugin} = createPlugin();
    plugin.settings.llmEndpoint = "";

    await expect((plugin as any).callLlm([])).rejects.toThrow("LLM endpoint is empty");
  });

  it("sends auth header when API key is present", async () => {
    const {plugin} = createPlugin();
    plugin.settings.llmEndpoint = "https://example.com/chat";
    plugin.settings.apiKey = "test-key";

    const requestUrlMock = vi.mocked(requestUrl);
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: {
        choices: [{message: {content: "Summary"}}]
      },
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
      text: ""
    });

    const summary = await (plugin as any).callLlm([{role: "user", content: "Hi"}]);

    expect(summary).toBe("Summary");
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-key"
        })
      })
    );
  });

  it("creates nested folders when missing", async () => {
    const {app, plugin} = createPlugin();

    app.vault.adapter.exists.mockResolvedValue(false);

    await (plugin as any).ensureFolderExists("daily_digests/2026");

    expect(app.vault.createFolder).toHaveBeenCalledTimes(2);
    expect(app.vault.createFolder).toHaveBeenCalledWith("daily_digests");
    expect(app.vault.createFolder).toHaveBeenCalledWith("daily_digests/2026");
  });
});
