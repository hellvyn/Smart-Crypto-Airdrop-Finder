import * as cheerio from "cheerio";
import { embedLinks, markBlocks, normalizeText } from "./html-text.js";
import type { CollectedDocument, CollectorResult, Http } from "./types.js";

const MAX_PAGES = 5;

interface TelegramMessage {
  id: number;
  url: string;
  publishedAt: Date;
  text: string;
}

interface ScannedPage {
  messages: TelegramMessage[];
  /** Ids of every message on the page, including ones without text (photos only). */
  ids: number[];
}

function scanPage(html: string, channel: string): ScannedPage {
  const $ = cheerio.load(html);
  const messages: TelegramMessage[] = [];
  const ids: number[] = [];
  embedLinks($, "https://t.me/");
  markBlocks($);
  $(".tgme_widget_message_wrap").each((_, wrap) => {
    const message = $(wrap).find(".tgme_widget_message[data-post]").first();
    const match = /\/(\d+)$/.exec(message.attr("data-post") ?? "");
    if (!match) return;
    const id = Number(match[1]);
    ids.push(id);

    // Skip the quoted text of the replied-to message.
    const textEl = message
      .find(".tgme_widget_message_text")
      .filter((_i, el) => $(el).closest(".tgme_widget_message_reply").length === 0)
      .first();
    const datetime = message.find("time[datetime]").first().attr("datetime");
    const publishedAt = datetime ? new Date(datetime) : null;
    if (textEl.length === 0 || !publishedAt || Number.isNaN(publishedAt.getTime())) return;

    const text = normalizeText(textEl.text());
    if (text === "") return;
    messages.push({ id, url: `https://t.me/${channel}/${id}`, publishedAt, text });
  });
  return { messages, ids };
}

export function parseTelegramPage(html: string, channel: string): { messages: TelegramMessage[] } {
  return { messages: scanPage(html, channel).messages };
}

export async function collectTelegram(
  http: Http,
  channel: string,
  sinceMessageId: number | null,
  now: Date,
): Promise<CollectorResult> {
  const sourceKey = `telegram:${channel}`;
  const base = `https://t.me/s/${channel}`;
  const collected = new Map<number, TelegramMessage>();
  const toDocuments = (): CollectedDocument[] =>
    [...collected.values()]
      .sort((a, b) => a.id - b.id)
      .map((m) => ({
        sourceKind: "telegram",
        sourceKey,
        url: m.url,
        text: m.text,
        publishedAt: m.publishedAt,
        pageUpdatedAt: null,
        fetchedAt: now,
      }));

  let url = base;
  let previousOldest = Number.POSITIVE_INFINITY;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await http.get(url);
    if (res.status !== 200) {
      return { sourceKey, documents: toDocuments(), failed: true, error: `page ${page} returned HTTP ${res.status}` };
    }
    const { messages, ids } = scanPage(res.body, channel);
    if (ids.length === 0) {
      // An empty first page means the HTML structure changed; an empty later page just ends the history.
      if (page === 1) {
        return { sourceKey, documents: [], failed: true, error: "channel page yielded no messages" };
      }
      break;
    }
    for (const m of messages) {
      if (sinceMessageId === null || m.id > sinceMessageId) collected.set(m.id, m);
    }
    if (sinceMessageId === null) break;
    const oldest = Math.min(...ids);
    if (oldest <= sinceMessageId || oldest >= previousOldest) break;
    previousOldest = oldest;
    url = `${base}?before=${oldest}`;
  }
  return { sourceKey, documents: toDocuments(), failed: false };
}
