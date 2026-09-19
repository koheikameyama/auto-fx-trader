import { describe, it, expect, vi, afterEach } from "vitest";
import { sendSlack, formatEntry, formatExit } from "../slack-notifier.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SLACK_WEBHOOK_URL;
});

describe("sendSlack", () => {
  it("does nothing when SLACK_WEBHOOK_URL is not set", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await sendSlack({ text: "hello", level: "info" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the webhook URL with a colored attachment", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    await sendSlack({ text: "line1\nline2", level: "warn" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.test/x");
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain("⚠️");
    expect(body.text).toContain("line1");
    expect(body.attachments[0].color).toBe("warning");
    expect(body.attachments[0].text).toBe("line1\nline2");
  });

  it("swallows fetch failures without throwing", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    await expect(sendSlack({ text: "x", level: "error" })).resolves.toBeUndefined();
  });
});

describe("formatEntry", () => {
  it("includes the divergence between theoretical and filled price in pips", () => {
    const text = formatEntry({
      dryRun: false,
      pair: "USDJPY",
      side: "long",
      units: 1000,
      filledPrice: 154.32,
      theoreticalPrice: 154.3,
      stopLoss: 153.5,
      pipSize: 0.01,
    });
    expect(text).toContain("ENTRY");
    expect(text).toContain("USDJPY");
    expect(text).toContain("+2.0 pips");
  });

  it("prefixes with [DRY RUN] when dryRun is true", () => {
    const text = formatEntry({
      dryRun: true,
      pair: "USDJPY",
      side: "short",
      units: 500,
      filledPrice: 154.0,
      theoreticalPrice: 154.0,
      stopLoss: 154.5,
      pipSize: 0.01,
    });
    expect(text).toMatch(/^\[DRY RUN\]/);
  });
});

describe("formatExit", () => {
  it("formats exit reason, pips and holding days", () => {
    const text = formatExit({
      dryRun: false,
      pair: "USDJPY",
      reason: "trailing",
      exitPrice: 155.0,
      pnlPips: 70,
      pnlJpy: 12345,
      holdingDays: 4,
    });
    expect(text).toContain("trailing");
    expect(text).toContain("+70.0 pips");
    expect(text).toContain("保有 4日");
  });
});
