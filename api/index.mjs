// api/_app.ts
import express2 from "express";

// server-core.ts
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import nodemailer from "nodemailer";

// src/utils/bidSearchParser.ts
var MONTH_MAP = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12"
};
function pad2(val) {
  return String(val).padStart(2, "0");
}
function clampString(value, maxLen, fallback = "") {
  const str = typeof value === "string" ? value.trim() : fallback;
  return str.slice(0, maxLen);
}
function sanitizeDistrictStateLocation(raw) {
  if (typeof raw !== "string") return "";
  const firstLine = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
  if (!firstLine) return "";
  let cleaned = firstLine.replace(/[*`"'"]/g, "").replace(/\[\d+\]/g, "").replace(/\bpin\s*code\b[:\-\s]*/gi, "").replace(/[-–,\s]*\b\d{6}\b/g, "").replace(/,\s*india\s*$/i, "").replace(/\b(district|distt?\.?)\b/gi, "").replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").replace(/^[,.\s-]+|[,.\s-]+$/g, "").trim();
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 2) {
    cleaned = `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`;
  } else if (parts.length === 2) {
    cleaned = `${parts[0]}, ${parts[1]}`;
  }
  return clampString(cleaned, 120);
}
function parseNumericAmount(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[₹,\s]|rs\.?|inr/gi, "").trim();
    if (!cleaned) return 0;
    const match = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!match) return 0;
    const num = Number(match[0]);
    return Number.isFinite(num) && num >= 0 ? Math.round(num) : 0;
  }
  return 0;
}
function parseTimeParts(timeRaw) {
  if (!timeRaw) return { hh: "17", mm: "00" };
  const match = timeRaw.trim().match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i);
  if (!match) return { hh: "17", mm: "00" };
  let hours = Number(match[1]);
  const mins = Number(match[2]);
  const meridiem = (match[3] || "").toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return { hh: "17", mm: "00" };
  return { hh: pad2(hours), mm: pad2(mins) };
}
function normalizeToIsoDate(raw) {
  if (typeof raw !== "string") return "";
  const text = raw.trim();
  if (!text) return "";
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${pad2(m)}-${pad2(d)}`;
    }
  }
  const dmyNumeric = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyNumeric) {
    const d = Number(dmyNumeric[1]);
    const m = Number(dmyNumeric[2]);
    const y = Number(dmyNumeric[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${pad2(m)}-${pad2(d)}`;
    }
  }
  const dmyAlpha = text.match(/^(\d{1,2})[\s\-/]+([a-zA-Z]+)[\s\-/,]+(\d{4})/);
  if (dmyAlpha) {
    const d = Number(dmyAlpha[1]);
    const monthStr = MONTH_MAP[dmyAlpha[2].toLowerCase()];
    const y = Number(dmyAlpha[3]);
    if (monthStr && d >= 1 && d <= 31) {
      return `${y}-${monthStr}-${pad2(d)}`;
    }
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  }
  return "";
}
function normalizeToIsoDateTime(raw, fallbackDate) {
  if (typeof raw === "string" && raw.trim()) {
    const text = raw.trim();
    const datePart = normalizeToIsoDate(text);
    if (datePart) {
      const timeMatch = text.match(/(?:T|\s+)(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)/i);
      const { hh, mm } = parseTimeParts(timeMatch?.[1]);
      return `${datePart}T${hh}:${mm}`;
    }
  }
  if (fallbackDate && /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate)) {
    return `${fallbackDate}T17:00`;
  }
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return `${today}T17:00`;
}
function normalizePortal(rawPortal, tenderId = "") {
  const raw = typeof rawPortal === "string" ? rawPortal.trim().toLowerCase() : "";
  if (raw.includes("gem") || raw.includes("government e marketplace") || tenderId.toUpperCase().startsWith("GEM/")) {
    return "GeM";
  }
  if (raw.includes("cppp") || raw.includes("eprocure") || raw.includes("nic") || tenderId.toUpperCase().startsWith("CPPP/")) {
    return "CPPP / eProcure";
  }
  if (raw.includes("state") || raw.includes("pwd") || raw.includes("mahatenders")) {
    return "State Portal";
  }
  if (raw.includes("psu") || raw.includes("direct")) {
    return "PSU / Direct";
  }
  if (raw.includes("private")) {
    return "Private";
  }
  return "GeM";
}
function detectMsmeEmdExemption(rawText, opts) {
  if (typeof rawText !== "string") return false;
  const text = rawText.trim();
  if (!text) return false;
  if (/\bmsme\b/i.test(text)) return true;
  if (/\budyam\b|\buam\b/i.test(text)) return true;
  if (/exempt(?:ed)?\s*[-–:]?\s*msme\/?startup/i.test(text)) return true;
  if (/\bemd\b[^\n.]{0,40}\bexempt(?:ed|ion)?\b|\bexempt(?:ed|ion)?\b[^\n.]{0,40}\bemd\b/i.test(text)) {
    return true;
  }
  if (/\bstartup\b(?=[^\n.]{0,50}\b(emd|exempt|exemption|relaxation|bid\s*security)\b)|\b(emd|exempt|exemption|relaxation|bid\s*security)\b(?=[^\n.]{0,50}\bstartup\b)/i.test(text)) {
    return true;
  }
  if (opts?.includeBareMse) {
    if (/\bmse\b/i.test(text)) return true;
  } else if (/\bmse\b(?=[^\n.]{0,50}\b(emd|exempt|exemption|relaxation|bid\s*security)\b)|\b(emd|exempt|exemption|relaxation|bid\s*security)\b(?=[^\n.]{0,50}\bmse\b)/i.test(text)) {
    return true;
  }
  return false;
}
function normalizeEmdSecurity(rawRequired, emdAmount, msmeExemptHint = false) {
  const text = typeof rawRequired === "string" ? rawRequired.trim().toLowerCase() : "";
  const hasExplicitExemption = msmeExemptHint || detectMsmeEmdExemption(text, { includeBareMse: true }) || text.includes("exempt");
  if (hasExplicitExemption && emdAmount === 0) {
    return "Exempted - MSME/Startup";
  }
  if (emdAmount > 0) {
    if (hasExplicitExemption) {
      return "Exempted - MSME/Startup";
    }
    if (text.includes("bg") || text.includes("bank guarantee") || text.includes("e-pbg")) {
      return "BG Submitted";
    }
    return "EMD Paid";
  }
  if (text.includes("no emd") || text.includes("not required") || text.includes("nil") || text === "no") {
    return "No EMD";
  }
  return "Exempted - MSME/Startup";
}
function normalizeExtractedBidDraft(raw, fallbackFileName = "") {
  const baseName = fallbackFileName.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim();
  const tenderId = clampString(raw.tenderId, 120) || clampString(baseName, 120) || `GEM-${Date.now()}`;
  const portal = normalizePortal(raw.portal, tenderId);
  const stage = "Identified / Reviewing";
  const department = clampString(raw.department, 200) || "Government Department / Organisation";
  const location = sanitizeDistrictStateLocation(raw.location) || "India";
  const title = clampString(raw.title, 300) || `GeM Bid ${tenderId}`;
  const category = clampString(raw.category, 120) || "Goods & Services";
  const publishDate = normalizeToIsoDate(raw.publishDate);
  const submissionDueDate = normalizeToIsoDateTime(raw.submissionDueDate, publishDate || void 0);
  const preBidDate = normalizeToIsoDate(raw.preBidDate);
  const estimatedValue = parseNumericAmount(raw.estimatedValue);
  const rawEmdAmount = parseNumericAmount(raw.emdAmount);
  const explicitMsmeFlag = raw.msmeExempt === true || typeof raw.msmeExempt === "string" && raw.msmeExempt.trim().toLowerCase() === "true";
  const textSignals = [raw.emdRequired, raw.emdStatus, raw.title, raw.category, raw.resultInfo].filter((v) => typeof v === "string" && v.trim().length > 0).join(" ");
  const emdFieldHasMse = detectMsmeEmdExemption(
    [raw.emdRequired, raw.emdStatus].filter((v) => typeof v === "string").join(" "),
    { includeBareMse: true }
  );
  const msmeExemptDetected = explicitMsmeFlag || emdFieldHasMse || detectMsmeEmdExemption(textSignals);
  const emdStatus = normalizeEmdSecurity(
    raw.emdRequired ?? raw.emdStatus,
    rawEmdAmount,
    msmeExemptDetected
  );
  const emdAmount = emdStatus === "Exempted - MSME/Startup" || emdStatus === "No EMD" ? 0 : rawEmdAmount;
  return {
    tenderId,
    portal,
    stage,
    department,
    location,
    title,
    category,
    publishDate,
    submissionDueDate,
    preBidDate,
    completionDate: "",
    estimatedValue,
    quotedValue: 0,
    emdStatus,
    emdAmount,
    resultInfo: ""
  };
}

// src/utils/geminiRetry.ts
var PRIMARY_PDF_MODEL = "gemini-4-hydrogen";
var FALLBACK_PDF_MODEL = "gemini-3.1-flash-lite";
var DEFAULT_RETRY_DELAYS_MS = [2e3, 4e3, 8e3];
var MODEL_BUSY_COOLDOWN_MS = 12e4;
var modelCooldownUntilMs = /* @__PURE__ */ new Map();
function isModelInBusyCooldown(model, nowMs = Date.now()) {
  const until = modelCooldownUntilMs.get(model);
  if (until === void 0) return false;
  if (nowMs >= until) {
    modelCooldownUntilMs.delete(model);
    return false;
  }
  return true;
}
function recordModelBusyCooldown(model, durationMs = MODEL_BUSY_COOLDOWN_MS, nowMs = Date.now()) {
  if (!model || durationMs <= 0) return;
  modelCooldownUntilMs.set(model, nowMs + durationMs);
}
function clearModelBusyCooldown(model) {
  if (model) {
    modelCooldownUntilMs.delete(model);
  } else {
    modelCooldownUntilMs.clear();
  }
}
var TimeoutError = class extends Error {
  constructor(message = "Operation timed out") {
    super(message);
    this.code = "ETIMEDOUT";
    this.status = 504;
    this.name = "TimeoutError";
  }
};
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function extractErrorStatus(error) {
  if (!error || typeof error !== "object") return void 0;
  const record = error;
  for (const key of ["status", "statusCode", "code"]) {
    const val = record[key];
    if (typeof val === "number" && val >= 100 && val <= 599) {
      return val;
    }
    if (typeof val === "string" && /^\d{3}$/.test(val.trim())) {
      return Number(val.trim());
    }
  }
  const nested = record.error;
  if (nested && typeof nested === "object") {
    return extractErrorStatus(nested);
  }
  return void 0;
}
function extractErrorMessage(error) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || error.name;
  if (error && typeof error === "object") {
    const record = error;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
    if (record.error && typeof record.error === "object") {
      const nestedMsg = extractErrorMessage(record.error);
      if (nestedMsg) return nestedMsg;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown error";
    }
  }
  return String(error || "Unknown error");
}
function isNonRetryableAuthOrConfigError(error) {
  const status = extractErrorStatus(error);
  const msg = extractErrorMessage(error);
  if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED|UNAUTHENTICATED|invalid api key/i.test(
    msg
  )) {
    return true;
  }
  if (status === 401 || status === 403) {
    return true;
  }
  return false;
}
function isRetryableGeminiError(error) {
  if (isNonRetryableAuthOrConfigError(error)) {
    return false;
  }
  const status = extractErrorStatus(error);
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 408) {
    return true;
  }
  const msg = extractErrorMessage(error);
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError" || /\b(503|429|502|504|408)\b/.test(msg) || /UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|INTERNAL|high demand|overloaded|try again later|rate limit|quota|temporarily unavailable|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|network|socket hang up|timed out|timeout|empty response/i.test(
    msg
  )) {
    return true;
  }
  return false;
}
async function withTimeout(promise, timeoutMs, timeoutMessage = "Request timed out while processing PDF.") {
  if (timeoutMs <= 0) {
    throw new TimeoutError(timeoutMessage);
  }
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new TimeoutError(timeoutMessage));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== void 0) {
      clearTimeout(timer);
    }
  }
}
function getRetryDelayMs(retryIndex, delaysMs = DEFAULT_RETRY_DELAYS_MS) {
  if (delaysMs.length === 0) return 0;
  if (retryIndex < delaysMs.length) return delaysMs[retryIndex];
  const last = delaysMs[delaysMs.length - 1];
  const extraSteps = retryIndex - delaysMs.length + 1;
  return last * 2 ** extraSteps;
}
async function withRetry(fn, options = {}) {
  const maxRetries = Math.max(0, options.maxRetries ?? 3);
  const delaysMs = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const shouldRetry = options.shouldRetry ?? isRetryableGeminiError;
  const sleepFn = options.sleepFn ?? defaultSleep;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const value = await fn(attempt);
      return { value, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !shouldRetry(error)) {
        throw error;
      }
      const scheduledDelay = getRetryDelayMs(attempt, delaysMs);
      if (options.deadlineAtMs !== void 0) {
        const remainingMs = options.deadlineAtMs - Date.now();
        if (remainingMs <= scheduledDelay + 1500) {
          throw error;
        }
      }
      options.onRetry?.({
        attempt: attempt + 1,
        maxRetries,
        delayMs: scheduledDelay,
        error
      });
      if (scheduledDelay > 0) {
        await sleepFn(scheduledDelay);
      }
    }
  }
  throw lastError;
}
async function executeWithRetryAndFallback({
  primaryModel = PRIMARY_PDF_MODEL,
  fallbackModel = FALLBACK_PDF_MODEL,
  primaryRetryOptions = {},
  fallbackRetryOptions = {},
  skipPrimaryIfInCooldown = false,
  cooldownDurationMs = MODEL_BUSY_COOLDOWN_MS,
  nowFn = () => Date.now(),
  runAttempt,
  onFallback
}) {
  const canUseDistinctFallback = Boolean(fallbackModel && fallbackModel !== primaryModel);
  if (skipPrimaryIfInCooldown && canUseDistinctFallback && isModelInBusyCooldown(primaryModel, nowFn())) {
    try {
      const fastRes = await withRetry(
        (attemptIndex) => runAttempt(fallbackModel, attemptIndex),
        {
          maxRetries: 2,
          delaysMs: [1500, 3e3],
          ...fallbackRetryOptions
        }
      );
      return {
        result: fastRes.value,
        modelUsed: fallbackModel,
        fallbackUsed: true,
        primaryAttempts: 0,
        totalAttempts: fastRes.attempts
      };
    } catch (fastError) {
      if (isNonRetryableAuthOrConfigError(fastError)) {
        throw fastError;
      }
      let backupAttempts = 0;
      const backupRes = await withRetry(
        (attemptIndex) => {
          backupAttempts = attemptIndex + 1;
          return runAttempt(primaryModel, attemptIndex);
        },
        {
          maxRetries: 1,
          delaysMs: [1500],
          ...primaryRetryOptions
        }
      );
      clearModelBusyCooldown(primaryModel);
      return {
        result: backupRes.value,
        modelUsed: primaryModel,
        fallbackUsed: false,
        primaryAttempts: backupAttempts,
        totalAttempts: backupAttempts + 1
      };
    }
  }
  let primaryAttempts = 0;
  try {
    const primaryRes = await withRetry(
      (attemptIndex) => {
        primaryAttempts = attemptIndex + 1;
        return runAttempt(primaryModel, attemptIndex);
      },
      {
        maxRetries: 3,
        delaysMs: DEFAULT_RETRY_DELAYS_MS,
        ...primaryRetryOptions
      }
    );
    if (skipPrimaryIfInCooldown) {
      clearModelBusyCooldown(primaryModel);
    }
    return {
      result: primaryRes.value,
      modelUsed: primaryModel,
      fallbackUsed: false,
      primaryAttempts: primaryRes.attempts,
      totalAttempts: primaryRes.attempts
    };
  } catch (primaryError) {
    if (isNonRetryableAuthOrConfigError(primaryError) || !canUseDistinctFallback) {
      throw primaryError;
    }
    const canFallback = isRetryableGeminiError(primaryError) || extractErrorStatus(primaryError) === 404 || /NOT_FOUND|model.*not found|unsupported/i.test(extractErrorMessage(primaryError));
    if (!canFallback) {
      throw primaryError;
    }
    onFallback?.({
      fromModel: primaryModel,
      toModel: fallbackModel,
      error: primaryError
    });
    const fallbackRes = await withRetry(
      (attemptIndex) => runAttempt(fallbackModel, attemptIndex),
      {
        maxRetries: 1,
        delaysMs: [1500],
        ...fallbackRetryOptions
      }
    );
    if (skipPrimaryIfInCooldown) {
      recordModelBusyCooldown(primaryModel, cooldownDurationMs, nowFn());
    }
    return {
      result: fallbackRes.value,
      modelUsed: fallbackModel,
      fallbackUsed: true,
      primaryAttempts,
      totalAttempts: primaryAttempts + fallbackRes.attempts
    };
  }
}
function extractJsonObjectFromText(rawText) {
  const cleaned = (rawText || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!cleaned) return null;
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const candidate = cleaned.slice(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
}
function sanitizeExtractErrorMessage(rawInput, httpStatus) {
  const extractedText = extractErrorMessage(rawInput).trim();
  const inferredStatus = httpStatus ?? extractErrorStatus(rawInput);
  if (inferredStatus === 503 || inferredStatus === 502 || /503|UNAVAILABLE|high demand|overloaded/i.test(extractedText)) {
    return "Server busy hai, kripya 5 second baad 'Retry This File' par click karein.";
  }
  if (inferredStatus === 429 || /429|RESOURCE_EXHAUSTED|rate limit|quota/i.test(extractedText)) {
    return "AI scanning limit temporary full ho gayi hai. Kripya thodi der baad 'Retry This File' karein.";
  }
  if (inferredStatus === 504 || inferredStatus === 408 || /AbortError|TimeoutError|timed out|timeout|DEADLINE_EXCEEDED/i.test(extractedText)) {
    return "Scan timeout ho gaya (58s limit). Network ya PDF bada hone ki wajah se time laga \u2014 'Retry This File' par click karein.";
  }
  if (inferredStatus === 413 || /payload too large|entity too large|413/i.test(extractedText)) {
    return "PDF file serverless size limit (~4.5 MB) se badi hai. Kripya smaller ya compressed PDF upload karein.";
  }
  if (inferredStatus === 401 || inferredStatus === 403 || /API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED/i.test(extractedText)) {
    return "Server AI configuration issue (GEMINI_API_KEY). Admin Settings / Secrets check karein.";
  }
  if (/fetch failed|Failed to fetch|NetworkError|ECONNRESET|ECONNREFUSED/i.test(extractedText)) {
    return "Network connection error. Internet check karke 'Retry This File' par click karein.";
  }
  const looksLikeRawJsonOrHtml = extractedText.startsWith("{") || extractedText.startsWith("[") || extractedText.startsWith("<") || extractedText.includes("<!DOCTYPE") || /"error"\s*:/.test(extractedText) || extractedText.length > 220;
  if (looksLikeRawJsonOrHtml || !extractedText) {
    return "PDF scan complete nahi ho paaya (temporary server error). Kripya 'Retry This File' par click karein.";
  }
  return extractedText;
}

// src/utils/mafCalculations.ts
var MAX_MAF_UPLOAD_BYTES = 5 * 1024 * 1024;

// src/utils/mafAutoGenerate.ts
function normalizeMafItemKey(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function parsePlainTextSpecItems(rawText) {
  if (!rawText || !rawText.trim()) return [];
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  const seenKeys = /* @__PURE__ */ new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /^(s\.?\s*no|sr\.?\s*no|item\s*(name|description)?|sl\.?\s*no|product)[,|;\t]/i.test(line)) {
      continue;
    }
    let candidateName = "";
    let candidateQty = "";
    if (line.includes(",") || line.includes("	") || line.includes("|")) {
      const sep = line.includes("	") ? "	" : line.includes("|") ? "|" : ",";
      const cols = line.split(sep).map((c) => c.replace(/^["']|["']$/g, "").trim());
      const nonEmpty = cols.filter(Boolean);
      if (nonEmpty.length >= 2 && /^\d+\.?$/.test(nonEmpty[0])) {
        candidateName = nonEmpty[1] || "";
        candidateQty = nonEmpty[2] || "";
      } else if (nonEmpty.length >= 1) {
        candidateName = nonEmpty[0] || "";
        candidateQty = nonEmpty[1] || "";
      }
    } else {
      const cleaned = line.replace(/^(?:\d+[.)]\s*|[-*•]\s*)/, "").trim();
      const dashQtyMatch = cleaned.match(
        /^(.*?)\s*(?:[-–—:]|\bQty\b[:\s]*)\s*(\d+\s*[A-Za-z.]*)$/i
      );
      const parenQtyMatch = cleaned.match(/^(.*?)\s*\((\d+\s*[A-Za-z.]*)\)$/);
      if (dashQtyMatch && dashQtyMatch[1].trim()) {
        candidateName = dashQtyMatch[1].trim();
        candidateQty = dashQtyMatch[2].trim();
      } else if (parenQtyMatch && parenQtyMatch[1].trim()) {
        candidateName = parenQtyMatch[1].trim();
        candidateQty = parenQtyMatch[2].trim();
      } else {
        candidateName = cleaned;
      }
    }
    const trimmedName = candidateName.trim().slice(0, 220);
    const key = normalizeMafItemKey(trimmedName);
    if (!trimmedName || !key || seenKeys.has(key)) continue;
    if (/^(total|grand total|note:|notes:|terms|specification|boq)$/i.test(trimmedName)) {
      continue;
    }
    seenKeys.add(key);
    items.push({
      itemName: trimmedName,
      requiredQuantity: candidateQty.trim().slice(0, 60)
    });
  }
  return items.slice(0, 50);
}

// server-core.ts
var ADMIN_USER_ID = "admin_vanshsales";
var ADMIN_USERNAME = "VanshSales";
var DEFAULT_ADMIN_PASSWORD = process.env.CRM_INITIAL_PASSWORD || "Vansh@2027";
var RECOVERY_EMAIL = "vanshsaxena7498@gmail.com";
var DEFAULT_EMAIL_RECIPIENT_NAME = "Vansh";
var IS_VERCEL = Boolean(process.env.VERCEL);
var DATA_DIR = IS_VERCEL ? path.join(os.tmpdir(), "vansh-crm-data") : path.resolve(process.cwd(), ".data");
var STATE_FILE = path.join(DATA_DIR, "crm-server-state.json");
function getHmacSecret() {
  return process.env.CRM_TOKEN_SECRET || process.env.SMTP_PASS || process.env.RESEND_API_KEY || "vansh-tender-software-otp-hmac-v1";
}
function signSignedToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getHmacSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}
function verifySignedToken(token) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) return null;
  const expectedSig = crypto.createHmac("sha256", getHmacSecret()).update(encoded).digest("base64url");
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
function signOtpToken(payload) {
  return signSignedToken(payload);
}
function verifyOtpToken(token) {
  const parsed = verifySignedToken(token);
  if (parsed && (!parsed.kind || parsed.kind === "reset_otp") && typeof parsed.salt === "string" && typeof parsed.otpHash === "string" && typeof parsed.expiresAt === "number") {
    return {
      kind: parsed.kind || "reset_otp",
      userId: typeof parsed.userId === "string" ? parsed.userId : ADMIN_USER_ID,
      username: typeof parsed.username === "string" ? parsed.username : ADMIN_USERNAME,
      email: typeof parsed.email === "string" ? parsed.email : RECOVERY_EMAIL,
      salt: parsed.salt,
      otpHash: parsed.otpHash,
      expiresAt: parsed.expiresAt
    };
  }
  return null;
}
function signSignupOtpToken(payload) {
  return signSignedToken({ kind: "signup_otp", ...payload });
}
function verifySignupOtpToken(token) {
  const parsed = verifySignedToken(token);
  if (parsed && parsed.kind === "signup_otp" && typeof parsed.email === "string" && typeof parsed.salt === "string" && typeof parsed.otpHash === "string" && typeof parsed.expiresAt === "number") {
    return {
      email: parsed.email.toLowerCase(),
      salt: parsed.salt,
      otpHash: parsed.otpHash,
      expiresAt: parsed.expiresAt
    };
  }
  return null;
}
function signSignupVerifiedToken(email, expiresAt) {
  return signSignedToken({ kind: "signup_verified", email: email.toLowerCase(), expiresAt });
}
function verifySignupVerifiedToken(token) {
  const parsed = verifySignedToken(token);
  if (parsed && parsed.kind === "signup_verified" && typeof parsed.email === "string" && typeof parsed.expiresAt === "number") {
    return { email: parsed.email.toLowerCase(), expiresAt: parsed.expiresAt };
  }
  return null;
}
function signVerifiedResetToken(params) {
  return signSignedToken({
    kind: "otp_verified",
    userId: params.userId,
    username: params.username,
    email: params.email,
    expiresAt: params.expiresAt
  });
}
function verifyVerifiedResetToken(token) {
  const parsed = verifySignedToken(token);
  if (parsed && parsed.kind === "otp_verified" && typeof parsed.expiresAt === "number") {
    return {
      userId: typeof parsed.userId === "string" ? parsed.userId : ADMIN_USER_ID,
      username: typeof parsed.username === "string" ? parsed.username : ADMIN_USERNAME,
      email: typeof parsed.email === "string" ? parsed.email : RECOVERY_EMAIL,
      expiresAt: parsed.expiresAt
    };
  }
  return null;
}
function signUserCredentialToken(record) {
  return signSignedToken({
    kind: "crm_user_cred",
    userId: record.userId,
    username: record.username,
    email: record.email,
    role: record.role,
    salt: record.salt,
    hash: record.hash,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    isActive: record.isActive
  });
}
function verifyUserCredentialToken(token) {
  const parsed = verifySignedToken(token);
  if (!parsed) return null;
  if (parsed.kind === "crm_user_cred" && typeof parsed.userId === "string" && typeof parsed.username === "string" && typeof parsed.email === "string" && typeof parsed.salt === "string" && typeof parsed.hash === "string" && typeof parsed.updatedAt === "string") {
    return {
      userId: parsed.userId,
      username: parsed.username,
      email: parsed.email.toLowerCase(),
      role: parsed.role === "admin" || parsed.userId === ADMIN_USER_ID ? "admin" : "secondary",
      salt: parsed.salt,
      hash: parsed.hash,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : parsed.updatedAt,
      updatedAt: parsed.updatedAt,
      isActive: parsed.isActive !== false
    };
  }
  if (parsed.kind === "crm_pwd" && parsed.username === ADMIN_USERNAME && typeof parsed.salt === "string" && typeof parsed.hash === "string" && typeof parsed.updatedAt === "string") {
    return {
      userId: ADMIN_USER_ID,
      username: ADMIN_USERNAME,
      email: RECOVERY_EMAIL,
      role: "admin",
      salt: parsed.salt,
      hash: parsed.hash,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: parsed.updatedAt,
      isActive: true
    };
  }
  return null;
}
function signAdminSessionToken(adminUser) {
  return signSignedToken({
    kind: "admin_session",
    userId: adminUser.userId,
    username: adminUser.username,
    email: adminUser.email,
    role: "admin",
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1e3
  });
}
function verifyAdminSessionToken(token) {
  const parsed = verifySignedToken(token);
  return Boolean(
    parsed && parsed.kind === "admin_session" && parsed.role === "admin" && parsed.userId === ADMIN_USER_ID && typeof parsed.expiresAt === "number" && Date.now() < parsed.expiresAt
  );
}
function readCookieValue(cookieHeader, name) {
  if (!cookieHeader) return "";
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return "";
}
function sanitizeServerUserForClient(user) {
  return {
    userId: user.userId,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    isActive: user.isActive !== false
  };
}
function maskEmailAddress(email) {
  const trimmed = email.trim();
  const atIdx = trimmed.indexOf("@");
  if (atIdx <= 1) return trimmed;
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  const visibleStart = local.slice(0, Math.min(2, local.length));
  const visibleEnd = local.length > 3 ? local.slice(-1) : "";
  return `${visibleStart}***${visibleEnd}@${domain}`;
}
function hashSecret(secret, salt) {
  const actualSalt = salt || crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(secret, actualSalt, 64).toString("hex");
  return { salt: actualSalt, hash: derived };
}
function verifyHashedSecret(secret, salt, expectedHash) {
  const derived = crypto.scryptSync(secret, salt, 64);
  const expectedBuf = Buffer.from(expectedHash, "hex");
  if (derived.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(derived, expectedBuf);
}
function createInitialState() {
  const { salt, hash } = hashSecret(DEFAULT_ADMIN_PASSWORD);
  const adminUpdatedAt = "1970-01-01T00:00:00.000Z";
  const adminUser = {
    userId: ADMIN_USER_ID,
    username: ADMIN_USERNAME,
    email: RECOVERY_EMAIL,
    role: "admin",
    salt,
    hash,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: adminUpdatedAt,
    isActive: true
  };
  return {
    passwordRecord: {
      salt,
      hash,
      updatedAt: adminUpdatedAt
    },
    pendingOtp: null,
    users: {
      [ADMIN_USER_ID]: adminUser
    },
    pendingOtps: {},
    emailLogs: []
  };
}
function loadServerState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed.passwordRecord?.salt && parsed.passwordRecord?.hash) {
        const users = parsed.users && typeof parsed.users === "object" ? { ...parsed.users } : {};
        if (!users[ADMIN_USER_ID]) {
          users[ADMIN_USER_ID] = {
            userId: ADMIN_USER_ID,
            username: ADMIN_USERNAME,
            email: RECOVERY_EMAIL,
            role: "admin",
            salt: parsed.passwordRecord.salt,
            hash: parsed.passwordRecord.hash,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: parsed.passwordRecord.updatedAt,
            isActive: true
          };
        }
        return {
          passwordRecord: parsed.passwordRecord,
          pendingOtp: parsed.pendingOtp ?? null,
          users,
          pendingOtps: parsed.pendingOtps && typeof parsed.pendingOtps === "object" ? parsed.pendingOtps : {},
          emailLogs: Array.isArray(parsed.emailLogs) ? parsed.emailLogs.slice(0, 200) : []
        };
      }
    }
  } catch {
  }
  const initial = createInitialState();
  saveServerState(initial);
  return initial;
}
function saveServerState(state) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to persist server auth state:", err);
  }
}
function readFirebaseApiKey() {
  if (process.env.VITE_FIREBASE_API_KEY) {
    return process.env.VITE_FIREBASE_API_KEY;
  }
  const candidatePaths = [
    path.resolve(process.cwd(), "firebase-applet-config.json"),
    path.resolve(process.cwd(), "..", "firebase-applet-config.json")
  ];
  for (const configPath of candidatePaths) {
    try {
      if (fs.existsSync(configPath)) {
        const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
        if (parsed.apiKey) return parsed.apiKey;
      }
    } catch {
    }
  }
  return "";
}
function isValidEmailAddress(raw) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}
function detectEmailProvider() {
  if (process.env.RESEND_API_KEY?.trim()) return "resend";
  if (process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()) return "smtp";
  return "none";
}
var DEFAULT_MAIL_FROM = "no-reply@vanshtender.in";
function resolveMailFromHeader() {
  const rawFrom = process.env.MAIL_FROM?.trim() || process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_MAIL_FROM;
  if (!rawFrom) {
    return `Vansh Tender Software <${DEFAULT_MAIL_FROM}>`;
  }
  return rawFrom.includes("<") ? rawFrom : `Vansh Tender Software <${rawFrom}>`;
}
async function sendAppEmail(params) {
  const provider = detectEmailProvider();
  const recipient = params.to.trim();
  if (provider === "resend") {
    try {
      const fromHeader = resolveMailFromHeader();
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY?.trim()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: fromHeader,
          to: [recipient],
          subject: params.subject,
          text: params.text,
          ...params.html ? { html: params.html } : {}
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        return { sent: false, provider, error: `Resend API error (${res.status}): ${errText}` };
      }
      return { sent: true, provider };
    } catch (err) {
      return {
        sent: false,
        provider,
        error: err instanceof Error ? err.message : "Resend email request failed."
      };
    }
  }
  if (provider === "smtp") {
    const smtpHost = (process.env.SMTP_HOST || "smtp.gmail.com").trim();
    const smtpPort = Number(process.env.SMTP_PORT || 465);
    const smtpUser = (process.env.SMTP_USER || "").trim();
    const rawPass = (process.env.SMTP_PASS || "").trim();
    const smtpPass = /^[a-zA-Z]{4}( [a-zA-Z]{4}){3}$/.test(rawPass) ? rawPass.replace(/\s+/g, "") : rawPass;
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });
      await transporter.sendMail({
        from: `"Vansh Tender Software" <${smtpUser}>`,
        to: recipient,
        subject: params.subject,
        text: params.text,
        ...params.html ? { html: params.html } : {}
      });
      return { sent: true, provider };
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : "SMTP email delivery failed.";
      const friendlyMsg = /534[- ]5\.7\.9|Application-specific password required/i.test(rawMsg) ? "Gmail requires a 16-character App Password in SMTP_PASS (regular Gmail passwords are blocked by 2FA)." : /535[- ]5\.7\.8|Username and Password not accepted/i.test(rawMsg) ? "Gmail rejected SMTP_USER / SMTP_PASS credentials. Please check your 16-character Google App Password in SMTP_PASS." : rawMsg;
      return {
        sent: false,
        provider,
        error: friendlyMsg
      };
    }
  }
  return {
    sent: false,
    provider: "none",
    error: "Email gateway (SMTP_USER/SMTP_PASS or RESEND_API_KEY) is not configured."
  };
}
async function sendSignupOtpEmail(targetEmail, otpCode) {
  const subject = "Vansh Tender Software \u2014 New User Gmail Verification Code";
  const textBody = [
    "Hello,",
    "",
    "Use the 6-digit verification code below to verify your Gmail and create your CRM account:",
    "",
    `Verification Code: ${otpCode}`,
    "",
    "This code expires in 15 minutes. If you did not initiate this sign-up, you can safely ignore this email.",
    "",
    "Regards,",
    "Vansh Tender Software Security Desk"
  ].join("\n");
  const htmlBody = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;color:#0f172a;">
      <h2 style="margin:0 0 8px;color:#0B1E47;">Vansh Tender Software</h2>
      <p style="margin:0 0 16px;font-size:14px;color:#475569;">New User Gmail Verification for <strong>${targetEmail}</strong></p>
      <div style="padding:16px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;text-align:center;margin-bottom:16px;">
        <p style="margin:0 0 6px;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:1px;">Sign-Up OTP Code</p>
        <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:6px;color:#0B1E47;font-family:monospace;">${otpCode}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#475569;">Enter this code in the CRM sign-up form to set up your User ID and Password. Expires in <strong>15 minutes</strong>.</p>
    </div>
  `;
  return sendAppEmail({
    to: targetEmail,
    subject,
    text: textBody,
    html: htmlBody
  });
}
async function sendRecoveryOtpEmail(otpCode, target) {
  const subject = "Vansh Tender Software \u2014 Password Reset Verification Code";
  const greetingName = target.username === ADMIN_USERNAME ? "Vansh" : target.username;
  const textBody = [
    `Hello ${greetingName},`,
    "",
    `We received a password reset request for your Vansh Tender Software CRM account (User ID: ${target.username}).`,
    "",
    `Your 6-digit Password Reset Verification Code is: ${otpCode}`,
    "",
    "This code expires in 15 minutes. If you did not request this reset, you can safely ignore this email.",
    "",
    "Regards,",
    "Vansh Tender Software Security Desk"
  ].join("\n");
  const htmlBody = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;color:#0f172a;">
      <h2 style="margin:0 0 8px;color:#0B1E47;">Vansh Tender Software</h2>
      <p style="margin:0 0 16px;font-size:14px;color:#475569;">Password Reset Request for <strong>${target.username}</strong></p>
      <div style="padding:16px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;text-align:center;margin-bottom:16px;">
        <p style="margin:0 0 6px;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:1px;">Verification Code</p>
        <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:6px;color:#0B1E47;font-family:monospace;">${otpCode}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#475569;">Enter this code on the Login screen to choose a new password. The code expires in <strong>15 minutes</strong>.</p>
    </div>
  `;
  return sendAppEmail({
    to: target.toEmail,
    subject,
    text: textBody,
    html: htmlBody
  });
}
async function verifyGoogleIdTokenForEmail(idToken, expectedEmail) {
  const apiKey = readFirebaseApiKey();
  if (!apiKey) {
    return { ok: false, error: "Firebase Web API key not found on server." };
  }
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );
  const rawBody = await resp.text();
  if (!resp.ok) {
    return { ok: false, error: "Google token verification failed." };
  }
  let data = {};
  try {
    data = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: "Invalid JSON received from Google identity service." };
  }
  const user = data.users?.[0];
  if (!user || !user.emailVerified) {
    return { ok: false, error: "Google account email is not verified." };
  }
  if ((user.email || "").toLowerCase() !== expectedEmail.toLowerCase()) {
    return {
      ok: false,
      error: `Only the registered email (${expectedEmail}) is authorized to reset this account password.`
    };
  }
  return { ok: true, email: user.email };
}
function createApiRouter() {
  const router = express.Router();
  let state = loadServerState();
  const otpRateBuckets = /* @__PURE__ */ new Map();
  function checkOtpRateLimit(req, bucketKey, maxRequests = 15, windowMs = 6e4) {
    const ip = (typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"].split(",")[0]?.trim() : "") || req.ip || req.socket?.remoteAddress || "local";
    const key = `${bucketKey}:${ip}`;
    const now = Date.now();
    const recent = (otpRateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      otpRateBuckets.set(key, recent);
      return false;
    }
    recent.push(now);
    otpRateBuckets.set(key, recent);
    if (otpRateBuckets.size > 500) {
      for (const [k, list] of otpRateBuckets.entries()) {
        if (list.every((ts) => now - ts >= windowMs)) {
          otpRateBuckets.delete(k);
        }
      }
    }
    return true;
  }
  function buildUserPool(req, body) {
    const pool = /* @__PURE__ */ new Map();
    for (const user of Object.values(state.users || {})) {
      pool.set(user.userId, user);
    }
    if (!pool.has(ADMIN_USER_ID)) {
      pool.set(ADMIN_USER_ID, {
        userId: ADMIN_USER_ID,
        username: ADMIN_USERNAME,
        email: RECOVERY_EMAIL,
        role: "admin",
        salt: state.passwordRecord.salt,
        hash: state.passwordRecord.hash,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: state.passwordRecord.updatedAt,
        isActive: true
      });
    }
    const candidateTokens = [];
    const cookieToken = readCookieValue(req.headers.cookie, "vansh_crm_pwd");
    if (cookieToken) candidateTokens.push(cookieToken);
    if (body && typeof body.credentialToken === "string" && body.credentialToken) {
      candidateTokens.push(body.credentialToken);
    }
    if (body && Array.isArray(body.clientCredentialTokens)) {
      for (const tok of body.clientCredentialTokens) {
        if (typeof tok === "string" && tok) candidateTokens.push(tok);
      }
    }
    for (const token of candidateTokens) {
      const verified = verifyUserCredentialToken(token);
      if (!verified) continue;
      const current = pool.get(verified.userId);
      if (!current || verified.updatedAt >= current.updatedAt) {
        pool.set(verified.userId, {
          ...verified,
          lastLoginAt: current?.lastLoginAt
        });
      }
    }
    return pool;
  }
  function findUserInPool(pool, identifier) {
    const trimmed = identifier.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    for (const user of pool.values()) {
      if (user.userId.toLowerCase() === lower || user.username.toLowerCase() === lower || user.email.toLowerCase() === lower) {
        return user;
      }
    }
    return null;
  }
  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      emailProvider: detectEmailProvider(),
      recoveryEmail: maskEmailAddress(RECOVERY_EMAIL),
      runtime: IS_VERCEL ? "vercel-serverless" : "node-express"
    });
  });
  router.post("/auth/login", (req, res) => {
    const body = req.body || {};
    const identifier = typeof body.identifier === "string" && body.identifier.trim() ? body.identifier.trim() : typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!identifier) {
      res.status(400).json({ ok: false, error: "Please enter your User ID or Email ID." });
      return;
    }
    if (!password) {
      res.status(400).json({ ok: false, error: "Please enter your Password." });
      return;
    }
    const pool = buildUserPool(req, body);
    const matched = findUserInPool(pool, identifier);
    const isEmailInput = identifier.includes("@");
    const usernameMatches = matched && (isEmailInput || identifier === matched.username || identifier === matched.userId);
    if (!matched || !usernameMatches || matched.isActive === false || !verifyHashedSecret(password, matched.salt, matched.hash)) {
      res.status(401).json({
        ok: false,
        error: "Invalid User ID or password. Please check your credentials and try again."
      });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const updatedUser = {
      ...matched,
      lastLoginAt: nowIso
    };
    state = {
      ...state,
      users: {
        ...state.users,
        [updatedUser.userId]: updatedUser
      },
      ...updatedUser.role === "admin" ? {
        passwordRecord: {
          salt: updatedUser.salt,
          hash: updatedUser.hash,
          updatedAt: updatedUser.updatedAt
        }
      } : {}
    };
    saveServerState(state);
    const credentialToken = signUserCredentialToken(updatedUser);
    const adminSessionToken = updatedUser.role === "admin" ? signAdminSessionToken(updatedUser) : void 0;
    res.json({
      ok: true,
      username: updatedUser.username,
      user: sanitizeServerUserForClient(updatedUser),
      credentialToken,
      ...adminSessionToken ? { adminSessionToken } : {}
    });
  });
  router.post("/auth/signup/send-otp", async (req, res) => {
    try {
      if (!checkOtpRateLimit(req, "signup-otp")) {
        res.status(429).json({
          ok: false,
          error: "Too many OTP requests. Please wait a minute before requesting another code."
        });
        return;
      }
      const body = req.body || {};
      const targetEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!targetEmail || !isValidEmailAddress(targetEmail)) {
        res.status(400).json({
          ok: false,
          error: "Please enter a valid Gmail / email address to receive your verification OTP."
        });
        return;
      }
      if (targetEmail === RECOVERY_EMAIL.toLowerCase()) {
        res.status(409).json({
          ok: false,
          error: "This Gmail is reserved for the primary Admin account. Please use a different Gmail address."
        });
        return;
      }
      const pool = buildUserPool(req, body);
      const existingByEmail = findUserInPool(pool, targetEmail);
      if (existingByEmail) {
        res.status(409).json({
          ok: false,
          error: `An account (${existingByEmail.username}) is already registered with ${targetEmail}. Please sign in or use Forgot Password.`
        });
        return;
      }
      const otpCode = String(crypto.randomInt(1e5, 1e6));
      const { salt, hash } = hashSecret(otpCode);
      const expiresAt = Date.now() + 15 * 60 * 1e3;
      const otpToken = signSignupOtpToken({
        email: targetEmail,
        salt,
        otpHash: hash,
        expiresAt
      });
      state = {
        ...state,
        pendingOtps: {
          ...state.pendingOtps,
          [`signup:${targetEmail}`]: {
            purpose: "signup",
            email: targetEmail,
            salt,
            otpHash: hash,
            expiresAt,
            attempts: 0,
            requestedAt: (/* @__PURE__ */ new Date()).toISOString()
          }
        }
      };
      saveServerState(state);
      const delivery = await sendSignupOtpEmail(targetEmail, otpCode);
      if (!delivery.sent && delivery.provider !== "none") {
        res.status(502).json({
          ok: false,
          emailSent: false,
          recipient: targetEmail,
          error: delivery.error || `Failed to send verification OTP to ${targetEmail}. Please verify your email address and try again.`
        });
        return;
      }
      if (!delivery.sent) {
        res.status(503).json({
          ok: false,
          emailSent: false,
          providerConfigured: false,
          recipient: targetEmail,
          error: "Email gateway (SMTP_USER/SMTP_PASS or RESEND_API_KEY) is not configured on the server to send Gmail verification OTPs."
        });
        return;
      }
      res.json({
        ok: true,
        emailSent: true,
        providerConfigured: true,
        provider: delivery.provider,
        recipient: targetEmail,
        expiresInMinutes: 15,
        otpToken,
        message: `A 6-digit verification OTP has been sent to ${targetEmail}.`
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Unable to send sign-up verification OTP."
      });
    }
  });
  router.post("/auth/signup/verify-otp", (req, res) => {
    try {
      const body = req.body || {};
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const otp = typeof body.otp === "string" ? body.otp.trim() : "";
      if (!email || !isValidEmailAddress(email)) {
        res.status(400).json({ ok: false, error: "Valid Gmail address is required." });
        return;
      }
      if (!/^\d{6}$/.test(otp)) {
        res.status(400).json({
          ok: false,
          error: `Please enter the 6-digit verification OTP sent to ${email}.`
        });
        return;
      }
      const signed = typeof body.otpToken === "string" && body.otpToken ? verifySignupOtpToken(body.otpToken) : null;
      if (signed && signed.email !== email) {
        res.status(400).json({
          ok: false,
          error: "OTP token does not match the entered Gmail address. Please request a fresh OTP."
        });
        return;
      }
      const stored = state.pendingOtps[`signup:${email}`] || null;
      const activeOtp = signed ? {
        ...signed,
        attempts: stored && stored.otpHash === signed.otpHash ? stored.attempts : 0
      } : stored;
      if (!activeOtp) {
        res.status(400).json({
          ok: false,
          error: "No active sign-up OTP found. Please request a verification code first."
        });
        return;
      }
      if (Date.now() > activeOtp.expiresAt) {
        const nextOtps = { ...state.pendingOtps };
        delete nextOtps[`signup:${email}`];
        state = { ...state, pendingOtps: nextOtps };
        saveServerState(state);
        res.status(400).json({
          ok: false,
          error: "Verification OTP has expired. Please request a new code."
        });
        return;
      }
      if (activeOtp.attempts >= 5) {
        res.status(429).json({
          ok: false,
          error: "Too many invalid OTP attempts. Please request a new verification code."
        });
        return;
      }
      if (!verifyHashedSecret(otp, activeOtp.salt, activeOtp.otpHash)) {
        if (stored) {
          state = {
            ...state,
            pendingOtps: {
              ...state.pendingOtps,
              [`signup:${email}`]: {
                ...stored,
                attempts: stored.attempts + 1
              }
            }
          };
          saveServerState(state);
        }
        res.status(400).json({
          ok: false,
          error: "Invalid 6-digit verification OTP. Please check your Gmail inbox and try again."
        });
        return;
      }
      const verifiedToken = signSignupVerifiedToken(email, Date.now() + 20 * 60 * 1e3);
      res.json({
        ok: true,
        email,
        verifiedToken,
        message: "Gmail verified successfully! Now choose your User ID and Password."
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Unable to verify sign-up OTP."
      });
    }
  });
  router.post("/auth/signup/complete", (req, res) => {
    try {
      const body = req.body || {};
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const verifiedToken = typeof body.verifiedToken === "string" ? body.verifiedToken.trim() : "";
      if (!email || !isValidEmailAddress(email)) {
        res.status(400).json({ ok: false, error: "A verified Gmail address is required." });
        return;
      }
      const verifiedClaim = verifiedToken ? verifySignupVerifiedToken(verifiedToken) : null;
      if (!verifiedClaim || verifiedClaim.email !== email || Date.now() > verifiedClaim.expiresAt) {
        res.status(403).json({
          ok: false,
          error: "Gmail OTP verification is missing or expired. Please verify your Gmail OTP again."
        });
        return;
      }
      if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
        res.status(400).json({
          ok: false,
          error: 'User ID must be 3 to 40 characters and contain only letters, numbers, "_", ".", or "-".'
        });
        return;
      }
      if (password.length < 6 || password.length > 128) {
        res.status(400).json({
          ok: false,
          error: "Password must be between 6 and 128 characters."
        });
        return;
      }
      if (username.toLowerCase() === ADMIN_USERNAME.toLowerCase() || email === RECOVERY_EMAIL.toLowerCase()) {
        res.status(409).json({
          ok: false,
          error: "This User ID or Gmail belongs to the primary Admin account."
        });
        return;
      }
      const pool = buildUserPool(req, body);
      const existingByUsername = findUserInPool(pool, username);
      if (existingByUsername) {
        res.status(409).json({
          ok: false,
          error: `User ID "${username}" is already taken. Please choose another User ID.`
        });
        return;
      }
      const existingByEmail = findUserInPool(pool, email);
      if (existingByEmail) {
        res.status(409).json({
          ok: false,
          error: `Gmail "${email}" is already linked to account "${existingByEmail.username}".`
        });
        return;
      }
      const slug = username.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
      const userId = `sec_${slug}_${crypto.randomBytes(2).toString("hex")}`;
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const { salt, hash } = hashSecret(password);
      const newUser = {
        userId,
        username,
        email,
        role: "secondary",
        salt,
        hash,
        createdAt: nowIso,
        updatedAt: nowIso,
        isActive: true
      };
      const nextOtps = { ...state.pendingOtps };
      delete nextOtps[`signup:${email}`];
      state = {
        ...state,
        users: {
          ...state.users,
          [newUser.userId]: newUser
        },
        pendingOtps: nextOtps
      };
      saveServerState(state);
      const credentialToken = signUserCredentialToken(newUser);
      res.status(201).json({
        ok: true,
        user: sanitizeServerUserForClient(newUser),
        credentialToken,
        message: "Successful ID Creation! Redirecting to the Login screen."
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Unable to complete new user registration."
      });
    }
  });
  router.post("/auth/forgot-password", async (req, res) => {
    try {
      if (!checkOtpRateLimit(req, "forgot-otp")) {
        res.status(429).json({
          ok: false,
          error: "Too many password reset requests. Please wait a minute before trying again."
        });
        return;
      }
      const body = req.body || {};
      const rawIdentifier = typeof body.identifier === "string" && body.identifier.trim() || typeof body.username === "string" && body.username.trim() || typeof body.targetEmail === "string" && body.targetEmail.trim() || "";
      const pool = buildUserPool(req, body);
      const targetUser = rawIdentifier ? findUserInPool(pool, rawIdentifier) : pool.get(ADMIN_USER_ID) || null;
      if (!targetUser) {
        res.status(404).json({
          ok: false,
          error: `No CRM account found matching "${rawIdentifier}". Enter your exact User ID or registered Gmail address.`
        });
        return;
      }
      const otpCode = String(crypto.randomInt(1e5, 1e6));
      const { salt, hash } = hashSecret(otpCode);
      const expiresAt = Date.now() + 15 * 60 * 1e3;
      const otpToken = signOtpToken({
        kind: "reset_otp",
        userId: targetUser.userId,
        username: targetUser.username,
        email: targetUser.email,
        salt,
        otpHash: hash,
        expiresAt
      });
      const otpRecord = {
        purpose: "reset",
        userId: targetUser.userId,
        username: targetUser.username,
        email: targetUser.email,
        salt,
        otpHash: hash,
        expiresAt,
        attempts: 0,
        requestedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      state = {
        ...state,
        pendingOtp: targetUser.role === "admin" ? otpRecord : state.pendingOtp,
        pendingOtps: {
          ...state.pendingOtps,
          [`reset:${targetUser.userId}`]: otpRecord
        }
      };
      saveServerState(state);
      const delivery = await sendRecoveryOtpEmail(otpCode, {
        username: targetUser.username,
        toEmail: targetUser.email
      });
      if (!delivery.sent && delivery.provider !== "none") {
        res.status(502).json({
          ok: false,
          emailSent: false,
          userId: targetUser.userId,
          username: targetUser.username,
          recipient: targetUser.email,
          targetEmail: targetUser.email,
          maskedEmail: maskEmailAddress(targetUser.email),
          error: delivery.error || `Failed to deliver password reset email to ${targetUser.email}. Please check SMTP/Resend settings.`
        });
        return;
      }
      if (!delivery.sent) {
        res.json({
          ok: true,
          emailSent: false,
          providerConfigured: false,
          userId: targetUser.userId,
          username: targetUser.username,
          recipient: targetUser.email,
          targetEmail: targetUser.email,
          maskedEmail: maskEmailAddress(targetUser.email),
          message: `Email gateway (SMTP_USER/SMTP_PASS or RESEND_API_KEY) is not configured yet. Configure it to send OTP emails to ${targetUser.email}, or verify ownership directly with Google (${targetUser.email}) below.`
        });
        return;
      }
      res.json({
        ok: true,
        emailSent: true,
        providerConfigured: true,
        provider: delivery.provider,
        userId: targetUser.userId,
        username: targetUser.username,
        recipient: targetUser.email,
        targetEmail: targetUser.email,
        maskedEmail: maskEmailAddress(targetUser.email),
        expiresInMinutes: 15,
        otpToken,
        message: `A 6-digit password reset code has been sent to ${targetUser.email}.`
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Unable to process password reset request."
      });
    }
  });
  const handleVerifyCode = (req, res) => {
    try {
      const body = req.body || {};
      const otp = typeof body.otp === "string" ? body.otp.trim() : "";
      const signedPayload = typeof body.otpToken === "string" && body.otpToken ? verifyOtpToken(body.otpToken) : null;
      const targetUserId = signedPayload?.userId || typeof body.userId === "string" && body.userId.trim() || ADMIN_USER_ID;
      const storedForUser = state.pendingOtps[`reset:${targetUserId}`] || (targetUserId === ADMIN_USER_ID ? state.pendingOtp : null);
      const targetEmail = signedPayload?.email || storedForUser?.email || RECOVERY_EMAIL;
      const targetUsername = signedPayload?.username || storedForUser?.username || ADMIN_USERNAME;
      if (!/^\d{6}$/.test(otp)) {
        res.status(400).json({
          ok: false,
          error: `Please enter the 6-digit verification code sent to ${targetEmail}.`
        });
        return;
      }
      const activeOtp = signedPayload ? {
        ...signedPayload,
        attempts: storedForUser && storedForUser.otpHash === signedPayload.otpHash ? storedForUser.attempts : 0
      } : storedForUser;
      if (!activeOtp) {
        res.status(400).json({
          ok: false,
          error: "No active reset code found. Please request a fresh code first."
        });
        return;
      }
      if (Date.now() > activeOtp.expiresAt) {
        const nextOtps = { ...state.pendingOtps };
        delete nextOtps[`reset:${targetUserId}`];
        state = {
          ...state,
          pendingOtp: targetUserId === ADMIN_USER_ID ? null : state.pendingOtp,
          pendingOtps: nextOtps
        };
        saveServerState(state);
        res.status(400).json({
          ok: false,
          error: "Verification code has expired. Please request a new code."
        });
        return;
      }
      if (activeOtp.attempts >= 5) {
        const nextOtps = { ...state.pendingOtps };
        delete nextOtps[`reset:${targetUserId}`];
        state = {
          ...state,
          pendingOtp: targetUserId === ADMIN_USER_ID ? null : state.pendingOtp,
          pendingOtps: nextOtps
        };
        saveServerState(state);
        res.status(429).json({
          ok: false,
          error: "Too many invalid code attempts. Please request a new reset code."
        });
        return;
      }
      const matches = verifyHashedSecret(otp, activeOtp.salt, activeOtp.otpHash);
      if (!matches) {
        if (storedForUser) {
          const bumped = { ...storedForUser, attempts: storedForUser.attempts + 1 };
          state = {
            ...state,
            pendingOtp: targetUserId === ADMIN_USER_ID ? bumped : state.pendingOtp,
            pendingOtps: {
              ...state.pendingOtps,
              [`reset:${targetUserId}`]: bumped
            }
          };
          saveServerState(state);
        }
        res.status(400).json({
          ok: false,
          error: "Invalid 6-digit verification code. Please check your inbox and retry."
        });
        return;
      }
      const verifiedToken = signVerifiedResetToken({
        userId: targetUserId,
        username: targetUsername,
        email: targetEmail,
        expiresAt: activeOtp.expiresAt
      });
      res.json({
        ok: true,
        verifiedToken,
        userId: targetUserId,
        username: targetUsername,
        targetEmail,
        message: "Verification code confirmed. Enter your new password below."
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Unable to verify reset code."
      });
    }
  };
  router.post("/auth/verify-code", handleVerifyCode);
  router.post("/auth/verify-otp", handleVerifyCode);
  router.post("/auth/reset-password", async (req, res) => {
    try {
      const body = req.body || {};
      const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
      if (newPassword.length < 6 || newPassword.length > 128) {
        res.status(400).json({
          ok: false,
          error: "New password must be between 6 and 128 characters."
        });
        return;
      }
      const pool = buildUserPool(req, body);
      const verifiedClaim = typeof body.verifiedToken === "string" && body.verifiedToken ? verifyVerifiedResetToken(body.verifiedToken) : null;
      const signedOtpPayload = typeof body.otpToken === "string" && body.otpToken ? verifyOtpToken(body.otpToken) : null;
      const lookupKey = verifiedClaim?.userId || signedOtpPayload?.userId || typeof body.userId === "string" && body.userId.trim() || typeof body.identifier === "string" && body.identifier.trim() || ADMIN_USER_ID;
      const targetUser = findUserInPool(pool, lookupKey);
      if (!targetUser) {
        res.status(404).json({
          ok: false,
          error: "Target user account could not be resolved for password reset."
        });
        return;
      }
      if (body.mode === "google") {
        const token = typeof body.firebaseIdToken === "string" ? body.firebaseIdToken : "";
        if (!token) {
          res.status(400).json({ ok: false, error: "Google verification token is required." });
          return;
        }
        const verified = await verifyGoogleIdTokenForEmail(token, targetUser.email);
        if (!verified.ok) {
          res.status(403).json({ ok: false, error: verified.error || "Google verification failed." });
          return;
        }
      } else {
        if (verifiedClaim) {
          if (verifiedClaim.userId !== targetUser.userId) {
            res.status(403).json({
              ok: false,
              error: "Verification token does not match the selected CRM account."
            });
            return;
          }
          if (Date.now() > verifiedClaim.expiresAt) {
            res.status(400).json({
              ok: false,
              error: "Verification session expired. Please request a fresh code."
            });
            return;
          }
        } else {
          const otp = typeof body.otp === "string" ? body.otp.trim() : "";
          const storedForUser = state.pendingOtps[`reset:${targetUser.userId}`] || (targetUser.role === "admin" ? state.pendingOtp : null);
          const activeOtp = signedOtpPayload ? {
            ...signedOtpPayload,
            attempts: storedForUser && storedForUser.otpHash === signedOtpPayload.otpHash ? storedForUser.attempts : 0
          } : storedForUser;
          if (!activeOtp || signedOtpPayload?.userId && signedOtpPayload.userId !== targetUser.userId) {
            res.status(400).json({
              ok: false,
              error: "No active reset code found. Please request a fresh code first."
            });
            return;
          }
          if (Date.now() > activeOtp.expiresAt) {
            const nextOtps2 = { ...state.pendingOtps };
            delete nextOtps2[`reset:${targetUser.userId}`];
            state = {
              ...state,
              pendingOtp: targetUser.role === "admin" ? null : state.pendingOtp,
              pendingOtps: nextOtps2
            };
            saveServerState(state);
            res.status(400).json({
              ok: false,
              error: "Verification code has expired. Please request a new code."
            });
            return;
          }
          if (activeOtp.attempts >= 5) {
            const nextOtps2 = { ...state.pendingOtps };
            delete nextOtps2[`reset:${targetUser.userId}`];
            state = {
              ...state,
              pendingOtp: targetUser.role === "admin" ? null : state.pendingOtp,
              pendingOtps: nextOtps2
            };
            saveServerState(state);
            res.status(429).json({
              ok: false,
              error: "Too many invalid code attempts. Please request a new reset code."
            });
            return;
          }
          const matches = verifyHashedSecret(otp, activeOtp.salt, activeOtp.otpHash);
          if (!matches) {
            if (storedForUser) {
              const bumped = { ...storedForUser, attempts: storedForUser.attempts + 1 };
              state = {
                ...state,
                pendingOtp: targetUser.role === "admin" ? bumped : state.pendingOtp,
                pendingOtps: {
                  ...state.pendingOtps,
                  [`reset:${targetUser.userId}`]: bumped
                }
              };
              saveServerState(state);
            }
            res.status(400).json({
              ok: false,
              error: "Invalid 6-digit verification code. Please check your inbox and retry."
            });
            return;
          }
        }
      }
      const nextHash = hashSecret(newPassword);
      const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      const updatedUser = {
        ...targetUser,
        salt: nextHash.salt,
        hash: nextHash.hash,
        updatedAt
      };
      const nextOtps = { ...state.pendingOtps };
      delete nextOtps[`reset:${targetUser.userId}`];
      state = {
        ...state,
        ...targetUser.role === "admin" ? {
          passwordRecord: {
            salt: nextHash.salt,
            hash: nextHash.hash,
            updatedAt
          },
          pendingOtp: null
        } : {},
        users: {
          ...state.users,
          [updatedUser.userId]: updatedUser
        },
        pendingOtps: nextOtps
      };
      saveServerState(state);
      const credentialToken = signUserCredentialToken(updatedUser);
      if (targetUser.role === "admin") {
        const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https" || IS_VERCEL;
        res.setHeader(
          "Set-Cookie",
          `vansh_crm_pwd=${encodeURIComponent(credentialToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? "; Secure" : ""}`
        );
      }
      res.json({
        ok: true,
        username: updatedUser.username,
        user: sanitizeServerUserForClient(updatedUser),
        credentialToken,
        message: "Password has been reset successfully. You can now log in with your new password."
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to reset password."
      });
    }
  });
  router.get("/auth/secondary-users", (req, res) => {
    const adminToken = typeof req.headers["x-crm-admin-token"] === "string" ? req.headers["x-crm-admin-token"].trim() : "";
    if (!adminToken || !verifyAdminSessionToken(adminToken)) {
      res.status(403).json({
        ok: false,
        error: "Admin session authorization is required to view secondary accounts."
      });
      return;
    }
    const secondaryUsers = Object.values(state.users || {}).filter((u) => u.role === "secondary").sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).map(sanitizeServerUserForClient);
    res.json({
      ok: true,
      users: secondaryUsers
    });
  });
  router.get("/notifications/email/status", (req, res) => {
    const provider = detectEmailProvider();
    const tenantId = typeof req.query.tenantId === "string" && req.query.tenantId.trim() ? req.query.tenantId.trim() : ADMIN_USER_ID;
    const isAdminTenant = tenantId === ADMIN_USER_ID;
    const scopedLogs = state.emailLogs.filter(
      (entry) => isAdminTenant ? !entry.tenantId || entry.tenantId === ADMIN_USER_ID : entry.tenantId === tenantId
    );
    res.json({
      ok: true,
      provider,
      automatedConfigured: provider !== "none",
      defaultRecipientName: isAdminTenant ? DEFAULT_EMAIL_RECIPIENT_NAME : "",
      defaultRecipientEmail: isAdminTenant ? RECOVERY_EMAIL : "",
      scheduleLabels: ["11:00 AM IST", "4:00 PM IST"],
      logs: scopedLogs
    });
  });
  router.post("/notifications/email", async (req, res) => {
    try {
      const body = req.body || {};
      const tenantId = typeof body.tenantId === "string" && body.tenantId.trim() ? body.tenantId.trim() : ADMIN_USER_ID;
      const isAdminTenant = tenantId === ADMIN_USER_ID;
      const slot = body.slot || "slot_11am";
      const tenderId = String(body.tenderId || "").trim();
      const tenderRefId = String(body.tenderRefId || tenderId).trim();
      const recipientName = String(
        body.recipientName || (isAdminTenant ? DEFAULT_EMAIL_RECIPIENT_NAME : "User")
      ).trim();
      const recipientEmail = String(
        body.recipientEmail || (isAdminTenant ? RECOVERY_EMAIL : "")
      ).trim();
      const dueDateIso = String(body.dueDateIso || "").trim();
      const subject = String(body.subject || `NEW TENDER ALERT NOTIFICATION \xB7 ${tenderId}`).trim();
      const message = String(body.message || "").trim();
      const html = typeof body.html === "string" && body.html.trim() ? body.html : void 0;
      if (!tenderId || !message || !isValidEmailAddress(recipientEmail)) {
        res.status(400).json({
          ok: false,
          error: "Valid tender details, email body content, and recipient email address are required."
        });
        return;
      }
      const rawSlotKey = typeof body.slotKey === "string" && body.slotKey.trim() || `${tenderRefId}__${dueDateIso || "none"}__${slot}`;
      const slotKey = isAdminTenant ? rawSlotKey : `${tenantId}::${rawSlotKey}`;
      if (slot !== "test" && slot !== "manual") {
        const existingLog = state.emailLogs.find((l) => {
          const logTenantMatches = isAdminTenant ? !l.tenantId || l.tenantId === ADMIN_USER_ID : l.tenantId === tenantId;
          return logTenantMatches && (l.slotKey === slotKey || l.slotKey === rawSlotKey) && l.status === "sent";
        });
        if (existingLog) {
          res.json({
            ok: true,
            deduplicated: true,
            delivered: true,
            provider: existingLog.provider,
            logEntry: existingLog
          });
          return;
        }
      }
      const delivery = await sendAppEmail({
        to: recipientEmail,
        subject,
        text: message,
        html
      });
      const entry = {
        id: `emlog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tenantId,
        slotKey,
        tenderRefId,
        tenderId,
        slot,
        recipientName,
        recipientEmail,
        dueDateIso,
        status: delivery.sent ? "sent" : "failed",
        provider: delivery.provider,
        subject,
        message,
        ...delivery.error ? { errorDetail: delivery.error } : {},
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      state = {
        ...state,
        emailLogs: [entry, ...state.emailLogs].slice(0, 300)
      };
      saveServerState(state);
      res.json({
        ok: true,
        deduplicated: false,
        delivered: delivery.sent,
        provider: delivery.provider,
        ...delivery.error ? { errorDetail: delivery.error } : {},
        logEntry: entry
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to dispatch tender reminder email."
      });
    }
  });
  router.post("/tenders/extract-pdf", async (req, res) => {
    const routeStartedAt = Date.now();
    const TOTAL_ROUTE_BUDGET_MS = 54e3;
    const PRIMARY_ATTEMPT_TIMEOUT_MS = 14e3;
    const FALLBACK_ATTEMPT_TIMEOUT_MS = 2e4;
    try {
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
        res.status(503).json({
          ok: false,
          success: false,
          retryable: false,
          error: "Gemini API key is not configured on the server. Add GEMINI_API_KEY in AI Studio Secrets or Vercel Environment Variables."
        });
        return;
      }
      const body = req.body || {};
      const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : "bid-document.pdf";
      const mimeType = typeof body.mimeType === "string" && body.mimeType.trim() ? body.mimeType.trim() : "application/pdf";
      const rawBase64 = typeof body.fileBase64 === "string" ? body.fileBase64.trim() : "";
      const base64Data = rawBase64.replace(/^data:[^;]+;base64,/i, "");
      if (!base64Data) {
        res.status(400).json({
          ok: false,
          success: false,
          retryable: false,
          error: "No PDF content received. Please upload a valid .pdf file."
        });
        return;
      }
      if (mimeType !== "application/pdf" && !fileName.toLowerCase().endsWith(".pdf")) {
        res.status(400).json({
          ok: false,
          success: false,
          retryable: false,
          error: "Only PDF (.pdf) bid documents are supported for Bid Search scanning."
        });
        return;
      }
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build"
          }
        }
      });
      const promptText = [
        "Analyze this Indian GeM / Government tender bid PDF document and extract every field accurately into JSON.",
        "Extraction Rules:",
        '1. tenderId: Exact Bid Number / Document Number (e.g., "GEM/2026/B/8153995").',
        '2. portal: Return "GeM" if this is a Government e-Marketplace (GeM) bid document, otherwise "CPPP / eProcure", "State Portal", "PSU / Direct", or "Private".',
        '3. stage: Always return "Identified / Reviewing".',
        '4. department: Combine Ministry, Department, and Organisation Name cleanly (e.g., "Ministry Of Defence / Department Of Military Affairs (Indian Army)").',
        '5. location: Extract District and State from Consignee / Reporting Officer Address or Pre-Bid Venue (e.g., "Panchkula, Haryana").',
        "6. consigneeAddressRaw: Extract the complete verbatim Consignee / Reporting Officer / Delivery Address, PIN code, town/base, or Pre-Bid Venue from the PDF so District and State can be verified via Google Search.",
        "7. title: Extract BOQ Title or primary scope of supply/work.",
        "8. category: Extract Primary Product Category or main Item Category.",
        '9. publishDate: Extract Bid "Dated" / Published Date strictly in YYYY-MM-DD format.',
        '10. submissionDueDate: Extract "Bid End Date/Time" strictly in 24-hour YYYY-MM-DDTHH:mm format.',
        '11. preBidDate: Extract Pre-Bid Date in YYYY-MM-DD format if available, otherwise "".',
        '12. completionDate: Always return "".',
        "13. estimatedValue: Numeric INR value if Estimated Bid Value is explicitly stated, otherwise 0.",
        "14. quotedValue: Always return 0.",
        '15. emdRequired: Return "Required" if EMD Amount > 0 (or "BG Submitted" if Bank Guarantee / e-PBG is specified), "Exempted - MSME/Startup" if MSE/MSME/Udyam/Startup EMD exemption applies, or "Not Required" if EMD is No/Nil/Not Required.',
        "16. emdAmount: Numeric EMD Amount in INR (e.g., 150000), or 0 if none or MSME exempted.",
        '17. msmeExempt: Boolean true ONLY if the tender document states EMD exemption for MSME/MSE/Udyam/Startup bidders (e.g., "MSE/MSME EMD Exemption: Yes"), otherwise false.',
        '18. resultInfo: Always return "".'
      ].join("\n");
      const extractionSchema = {
        type: Type.OBJECT,
        properties: {
          tenderId: { type: Type.STRING, description: "Exact Tender ID / Bid Number" },
          portal: { type: Type.STRING, description: "Portal source such as GeM" },
          stage: { type: Type.STRING, description: "Always Identified / Reviewing" },
          department: {
            type: Type.STRING,
            description: "Combined Ministry, Department, and Organisation Name"
          },
          location: {
            type: Type.STRING,
            description: "District and State from Consignee Address or Pre-Bid Venue"
          },
          consigneeAddressRaw: {
            type: Type.STRING,
            description: "Complete verbatim Consignee / Delivery Address or PIN code from PDF"
          },
          title: {
            type: Type.STRING,
            description: "BOQ Title or primary scope of work"
          },
          category: {
            type: Type.STRING,
            description: "Primary Product Category or main Item Category"
          },
          publishDate: {
            type: Type.STRING,
            description: "Dated / Published Date in YYYY-MM-DD format"
          },
          submissionDueDate: {
            type: Type.STRING,
            description: "Bid End Date/Time in YYYY-MM-DDTHH:mm format"
          },
          preBidDate: {
            type: Type.STRING,
            description: "Pre-Bid Meeting Date in YYYY-MM-DD format or empty string"
          },
          completionDate: {
            type: Type.STRING,
            description: "Leave blank empty string"
          },
          estimatedValue: {
            type: Type.NUMBER,
            description: "Estimated Bid Value in INR if explicitly mentioned, else 0"
          },
          quotedValue: {
            type: Type.NUMBER,
            description: "Leave 0"
          },
          emdRequired: {
            type: Type.STRING,
            description: "Required, BG Submitted, Exempted - MSME/Startup, or Not Required"
          },
          emdAmount: {
            type: Type.NUMBER,
            description: "Numeric EMD amount in INR or 0"
          },
          msmeExempt: {
            type: Type.BOOLEAN,
            description: "True if tender grants EMD exemption for MSME/MSE/Udyam/Startup bidders"
          },
          resultInfo: {
            type: Type.STRING,
            description: "Leave blank empty string"
          }
        },
        required: [
          "tenderId",
          "portal",
          "stage",
          "department",
          "location",
          "consigneeAddressRaw",
          "title",
          "category",
          "publishDate",
          "submissionDueDate",
          "preBidDate",
          "completionDate",
          "estimatedValue",
          "quotedValue",
          "emdRequired",
          "emdAmount",
          "msmeExempt",
          "resultInfo"
        ]
      };
      const extractionOutcome = await executeWithRetryAndFallback({
        primaryModel: PRIMARY_PDF_MODEL,
        fallbackModel: FALLBACK_PDF_MODEL,
        skipPrimaryIfInCooldown: true,
        primaryRetryOptions: {
          maxRetries: 3,
          delaysMs: DEFAULT_RETRY_DELAYS_MS,
          deadlineAtMs: routeStartedAt + 3e4,
          onRetry: ({ attempt, maxRetries, delayMs, error }) => {
            console.warn(
              `[extract-pdf] Primary model ${PRIMARY_PDF_MODEL} busy on "${fileName}" (status=${extractErrorStatus(error) ?? "unknown"}). Retry ${attempt}/${maxRetries} in ${delayMs}ms.`
            );
          }
        },
        fallbackRetryOptions: {
          maxRetries: 2,
          delaysMs: [1500, 3e3],
          deadlineAtMs: routeStartedAt + TOTAL_ROUTE_BUDGET_MS - 2e3,
          onRetry: ({ attempt, maxRetries, delayMs, error }) => {
            console.warn(
              `[extract-pdf] Fallback model ${FALLBACK_PDF_MODEL} busy on "${fileName}" (status=${extractErrorStatus(error) ?? "unknown"}). Retry ${attempt}/${maxRetries} in ${delayMs}ms.`
            );
          }
        },
        onFallback: ({ fromModel, toModel, error }) => {
          console.warn(
            `[extract-pdf] Switching from ${fromModel} to fast fallback model ${toModel} for "${fileName}" (${extractErrorStatus(error) ?? ""} ${extractErrorMessage(error).slice(0, 140)}).`
          );
        },
        runAttempt: async (model) => {
          const remainingBudgetMs = routeStartedAt + TOTAL_ROUTE_BUDGET_MS - Date.now();
          const capMs = model === PRIMARY_PDF_MODEL ? PRIMARY_ATTEMPT_TIMEOUT_MS : FALLBACK_ATTEMPT_TIMEOUT_MS;
          const attemptTimeoutMs = Math.max(4e3, Math.min(capMs, remainingBudgetMs));
          if (remainingBudgetMs <= 1500) {
            throw new TimeoutError("Server time budget exceeded before completing PDF extraction.");
          }
          const modelResponse = await withTimeout(
            ai.models.generateContent({
              model,
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "application/pdf",
                      data: base64Data
                    }
                  },
                  {
                    text: promptText
                  }
                ]
              },
              config: {
                abortSignal: AbortSignal.timeout(attemptTimeoutMs),
                systemInstruction: "You are a precision Indian GeM and government tender PDF parser. Extract structured bid details strictly matching the JSON schema without inventing missing financial figures.",
                ...model === PRIMARY_PDF_MODEL ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {},
                responseMimeType: "application/json",
                responseSchema: extractionSchema
              }
            }),
            attemptTimeoutMs,
            "Gemini PDF extraction request timed out."
          );
          const rawText = (modelResponse.text ?? "").trim();
          const parsedJson = extractJsonObjectFromText(rawText);
          if (!parsedJson) {
            throw new Error("Gemini returned empty or invalid structured JSON output.");
          }
          return parsedJson;
        }
      });
      const parsed = extractionOutcome.result;
      const addressForSearch = typeof parsed.consigneeAddressRaw === "string" && parsed.consigneeAddressRaw.trim() ? parsed.consigneeAddressRaw.trim() : typeof parsed.location === "string" ? parsed.location.trim() : "";
      const remainingForGeoMs = routeStartedAt + TOTAL_ROUTE_BUDGET_MS - Date.now();
      if (addressForSearch && remainingForGeoMs >= 3500) {
        try {
          const geoModel = extractionOutcome.fallbackUsed ? FALLBACK_PDF_MODEL : PRIMARY_PDF_MODEL;
          const geoOutcome = await withRetry(
            async () => {
              const geoTimeout = Math.max(2500, Math.min(5e3, routeStartedAt + TOTAL_ROUTE_BUDGET_MS - Date.now()));
              return await withTimeout(
                ai.models.generateContent({
                  model: geoModel,
                  contents: [
                    "Using Google Search, find the exact Indian administrative District and State for the address below (lookup PIN code, locality, town, cantonment, or organisation campus if district is not explicitly stated).",
                    'Return ONLY "District, State" (for example: "Panchkula, Haryana" or "Lucknow, Uttar Pradesh") with no extra words, street address, or PIN code.',
                    "",
                    `Address from PDF: ${addressForSearch}`,
                    `Department / Organisation: ${typeof parsed.department === "string" ? parsed.department : ""}`,
                    `Initial Extracted Location: ${typeof parsed.location === "string" ? parsed.location : ""}`
                  ].join("\n"),
                  config: {
                    abortSignal: AbortSignal.timeout(geoTimeout),
                    tools: [{ googleSearch: {} }],
                    ...geoModel === PRIMARY_PDF_MODEL ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {},
                    systemInstruction: 'Output strictly "District, State" for an Indian address. Never include street address, PIN code, office name, bullet points, or explanatory text.'
                  }
                }),
                geoTimeout,
                "Google Search location grounding timed out."
              );
            },
            {
              maxRetries: remainingForGeoMs >= 9e3 ? 1 : 0,
              delaysMs: [1e3],
              deadlineAtMs: routeStartedAt + TOTAL_ROUTE_BUDGET_MS
            }
          );
          const groundedLocation = sanitizeDistrictStateLocation(geoOutcome.value.text ?? "");
          if (groundedLocation && groundedLocation.includes(",") && !/cannot|unable|unknown|sorry|not found/i.test(groundedLocation)) {
            parsed.location = groundedLocation;
          }
        } catch {
        }
      }
      const extracted = normalizeExtractedBidDraft(parsed, fileName);
      res.status(200).json({
        ok: true,
        success: true,
        modelUsed: extractionOutcome.modelUsed,
        fallbackUsed: extractionOutcome.fallbackUsed,
        extracted
      });
    } catch (err) {
      const inferredStatus = extractErrorStatus(err);
      const retryable = isRetryableGeminiError(err);
      const isAuthErr = isNonRetryableAuthOrConfigError(err);
      const httpStatus = isAuthErr ? 403 : inferredStatus === 429 ? 429 : err instanceof TimeoutError || inferredStatus === 504 ? 504 : retryable || inferredStatus === 503 || inferredStatus === 502 ? 503 : 500;
      const friendlyError = sanitizeExtractErrorMessage(err, httpStatus);
      console.error("[extract-pdf] Returning clean error JSON:", httpStatus, friendlyError);
      if (!res.headersSent) {
        res.status(httpStatus).json({
          ok: false,
          success: false,
          retryable,
          error: friendlyError
        });
      }
    }
  });
  function isValidAppsScriptUrl(rawUrl) {
    const trimmed = (rawUrl || "").trim();
    if (!trimmed || trimmed.length > 500) return false;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:") return false;
      const host = parsed.hostname.toLowerCase();
      if (host === "script.google.com" || host === "script.googleusercontent.com") {
        return parsed.pathname.startsWith("/macros/");
      }
      return false;
    } catch {
      return false;
    }
  }
  router.post("/sheet-sync", async (req, res) => {
    const body = req.body || {};
    const webhookUrl = typeof body.webhookUrl === "string" ? body.webhookUrl.trim() : "";
    if (!isValidAppsScriptUrl(webhookUrl)) {
      res.status(400).json({
        ok: false,
        error: "Invalid Google Apps Script Webhook URL. Expected https://script.google.com/macros/s/.../exec"
      });
      return;
    }
    if (!body.payload || typeof body.payload !== "object") {
      res.status(400).json({
        ok: false,
        error: "Missing structured JSON sync payload."
      });
      return;
    }
    try {
      const upstream = await fetch(webhookUrl, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body.payload),
        signal: AbortSignal.timeout(15e3)
      });
      const rawText = await upstream.text();
      const trimmed = rawText.trim();
      const lower = trimmed.toLowerCase();
      const looksLikeAuthHtml = lower.startsWith("<!doctype") || lower.startsWith("<html") || lower.startsWith("<head") || lower.startsWith("<body") || lower.startsWith("<title") || lower.includes("accounts.google.com") || lower.includes("servicelogin");
      if (looksLikeAuthHtml) {
        res.status(400).json({
          ok: false,
          error: 'Google Apps Script returned a login or HTML error page instead of JSON. In Apps Script -> Deploy -> Manage deployments, set "Who has access" to "Anyone" and redeploy.'
        });
        return;
      }
      let parsedJson = null;
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          parsedJson = JSON.parse(trimmed);
        } catch {
          parsedJson = null;
        }
      }
      if (!upstream.ok) {
        res.status(502).json({
          ok: false,
          error: parsedJson?.error || `Google Apps Script returned HTTP ${upstream.status}: ${trimmed.slice(0, 140) || "Verify the Web App deployment URL."}`
        });
        return;
      }
      if (!parsedJson) {
        res.status(502).json({
          ok: false,
          error: `Google Apps Script returned a non-JSON response: ${trimmed.slice(0, 160) || "(empty body)"}`
        });
        return;
      }
      if (parsedJson.ok === false) {
        res.status(400).json({
          ok: false,
          error: parsedJson.error || "Google Apps Script reported an execution error."
        });
        return;
      }
      res.json({
        ok: true,
        syncedAt: (/* @__PURE__ */ new Date()).toISOString(),
        scriptResponse: parsedJson
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to reach Google Apps Script Webhook URL.";
      res.status(502).json({
        ok: false,
        error: message.includes("Timeout") ? "Google Apps Script webhook timed out after 15s." : `Google Sheet webhook failed: ${message}`
      });
    }
  });
  router.post("/sheet-sync/pull", async (req, res) => {
    const body = req.body || {};
    const webhookUrl = typeof body.webhookUrl === "string" ? body.webhookUrl.trim() : "";
    if (!isValidAppsScriptUrl(webhookUrl)) {
      res.status(400).json({
        ok: false,
        error: "Invalid Google Apps Script Webhook URL."
      });
      return;
    }
    try {
      const upstream = await fetch(webhookUrl, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(15e3)
      });
      const text = await upstream.text();
      const trimmed = text.trim();
      if (!upstream.ok || !trimmed.startsWith("{")) {
        res.status(502).json({
          ok: false,
          error: `Could not read JSON status from Google Apps Script Web App (${trimmed.slice(0, 120) || upstream.status}).`
        });
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        res.status(502).json({
          ok: false,
          error: "Google Apps Script returned malformed JSON status."
        });
        return;
      }
      res.json({ ok: true, sheetStatus: parsed });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to query Google Sheet status."
      });
    }
  });
  router.post("/maf/extract-from-attachments", async (req, res) => {
    const routeStartedAt = Date.now();
    const TOTAL_ROUTE_BUDGET_MS = 54e3;
    const PRIMARY_ATTEMPT_TIMEOUT_MS = 14e3;
    const FALLBACK_ATTEMPT_TIMEOUT_MS = 2e4;
    const parseAttachmentPayload = (raw) => {
      if (!raw || typeof raw !== "object") return null;
      const obj = raw;
      const fileName = typeof obj.fileName === "string" ? obj.fileName.trim() : "";
      const rawDataUrl = typeof obj.dataUrl === "string" ? obj.dataUrl.trim() : "";
      if (!rawDataUrl) return null;
      const match = rawDataUrl.match(/^data:([^;]+);base64,(.+)$/i);
      const mimeType = (typeof obj.mimeType === "string" && obj.mimeType.trim() ? obj.mimeType.trim() : match?.[1] || "application/pdf").toLowerCase();
      const base64Data = (match?.[2] ?? rawDataUrl).replace(/\s+/g, "");
      if (!base64Data) return null;
      return {
        fileName: fileName || "document.pdf",
        mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType,
        base64Data
      };
    };
    const GEMINI_INLINE_MIME_TYPES = /* @__PURE__ */ new Set([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp"
    ]);
    const buildGeminiPartsForAttachment = (label, att) => {
      if (GEMINI_INLINE_MIME_TYPES.has(att.mimeType)) {
        return {
          parts: [
            { text: `[${label}: ${att.fileName}]` },
            { inlineData: { mimeType: att.mimeType, data: att.base64Data } }
          ]
        };
      }
      const lower = att.fileName.toLowerCase();
      if (att.mimeType.startsWith("text/") || att.mimeType === "application/csv" || lower.endsWith(".txt") || lower.endsWith(".csv")) {
        const decodedText = Buffer.from(att.base64Data, "base64").toString("utf8").slice(0, 6e4);
        return {
          parts: [{ text: `[${label}: ${att.fileName}]
${decodedText}` }],
          plainText: decodedText
        };
      }
      return {
        parts: [
          {
            text: `[${label}: ${att.fileName} (${att.mimeType}) \u2014 binary spreadsheet/word format]`
          }
        ]
      };
    };
    try {
      const body = req.body || {};
      const att1 = parseAttachmentPayload(body.attachment1);
      const att2 = parseAttachmentPayload(body.attachment2);
      const fallbackDepartment = typeof body.fallbackDepartment === "string" ? body.fallbackDepartment.trim() : "";
      if (!att1 && !att2) {
        res.status(400).json({
          ok: false,
          success: false,
          error: "At least Attachment 1 or Attachment 2 content is required."
        });
        return;
      }
      const built1 = att1 ? buildGeminiPartsForAttachment("Attachment 1 - Tender Inviting Authority / NIT Document", att1) : null;
      const built2 = att2 ? buildGeminiPartsForAttachment("Attachment 2 - BOQ / Specification Document", att2) : null;
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
        const fallbackItems = built2?.plainText ? parsePlainTextSpecItems(built2.plainText) : [];
        if (fallbackItems.length > 0) {
          res.status(200).json({
            ok: true,
            success: true,
            department: fallbackDepartment,
            items: fallbackItems,
            fallbackParserUsed: true
          });
          return;
        }
        res.status(503).json({
          ok: false,
          success: false,
          retryable: false,
          error: "Gemini API key is not configured on the server to extract MAF items from PDF/image attachments."
        });
        return;
      }
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build"
          }
        }
      });
      const parts = [
        ...built1?.parts ?? [],
        ...built2?.parts ?? [],
        {
          text: [
            "Extract Tender Department & Individual Product/Item rows strictly according to these rules:",
            '1. department: Extract the exact Tender Inviting Authority / Department / Organisation Name from Attachment 1 (NIT / Tender Document). If Attachment 1 is absent or has no department, return "".',
            "2. items: Extract EVERY individual required product/equipment/item listed in Attachment 2 (Specification / BOQ Document). If the tender requires 5 distinct products (for example: Item 1, Item 2, Item 3, Item 4, Item 5), return 5 separate objects in the items array\u2014never merge multiple products into one item.",
            '3. For each item object provide: itemName (concise product/equipment name without serial number prefix) and requiredQuantity (e.g. "10 Nos", "5 Sets", or "" if not specified).',
            "4. Do NOT guess or invent OEM names, brand names, emails, phone numbers, or contact persons."
          ].join("\n")
        }
      ];
      const mafSchema = {
        type: Type.OBJECT,
        properties: {
          department: {
            type: Type.STRING,
            description: "Tender Inviting Authority / Department extracted from Attachment 1"
          },
          items: {
            type: Type.ARRAY,
            description: "Individual required items extracted from Attachment 2",
            items: {
              type: Type.OBJECT,
              properties: {
                itemName: { type: Type.STRING, description: "Product / equipment name" },
                requiredQuantity: { type: Type.STRING, description: "Required quantity with unit or empty string" }
              },
              required: ["itemName", "requiredQuantity"]
            }
          }
        },
        required: ["department", "items"]
      };
      const outcome = await executeWithRetryAndFallback({
        primaryModel: PRIMARY_PDF_MODEL,
        fallbackModel: FALLBACK_PDF_MODEL,
        skipPrimaryIfInCooldown: true,
        primaryRetryOptions: {
          maxRetries: 2,
          delaysMs: DEFAULT_RETRY_DELAYS_MS,
          deadlineAtMs: routeStartedAt + 3e4
        },
        fallbackRetryOptions: {
          maxRetries: 2,
          delaysMs: [1500, 3e3],
          deadlineAtMs: routeStartedAt + TOTAL_ROUTE_BUDGET_MS - 2e3
        },
        runAttempt: async (model) => {
          const remainingBudgetMs = routeStartedAt + TOTAL_ROUTE_BUDGET_MS - Date.now();
          const capMs = model === PRIMARY_PDF_MODEL ? PRIMARY_ATTEMPT_TIMEOUT_MS : FALLBACK_ATTEMPT_TIMEOUT_MS;
          const attemptTimeoutMs = Math.max(4e3, Math.min(capMs, remainingBudgetMs));
          if (remainingBudgetMs <= 1500) {
            throw new TimeoutError("Server time budget exceeded during MAF attachment extraction.");
          }
          const modelResponse = await withTimeout(
            ai.models.generateContent({
              model,
              contents: { parts },
              config: {
                abortSignal: AbortSignal.timeout(attemptTimeoutMs),
                systemInstruction: "You are a tender specification parser. Extract the inviting department from Attachment 1 and every individual item from Attachment 2 as clean JSON.",
                ...model === PRIMARY_PDF_MODEL ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {},
                responseMimeType: "application/json",
                responseSchema: mafSchema
              }
            }),
            attemptTimeoutMs,
            "Gemini MAF attachment extraction timed out."
          );
          const rawText = (modelResponse.text ?? "").trim();
          const parsedJson = extractJsonObjectFromText(rawText);
          if (!parsedJson) {
            throw new Error("Gemini returned empty or invalid structured JSON for MAF items.");
          }
          return parsedJson;
        }
      });
      const extractedDepartment = (typeof outcome.result.department === "string" ? outcome.result.department.trim() : "") || fallbackDepartment;
      const geminiItems = Array.isArray(outcome.result.items) ? outcome.result.items.map((it) => ({
        itemName: typeof it?.itemName === "string" ? it.itemName.trim().slice(0, 220) : "",
        requiredQuantity: typeof it?.requiredQuantity === "string" ? it.requiredQuantity.trim().slice(0, 60) : ""
      })).filter((it) => it.itemName.length > 0).slice(0, 50) : [];
      const items = geminiItems.length > 0 ? geminiItems : built2?.plainText ? parsePlainTextSpecItems(built2.plainText) : [];
      res.status(200).json({
        ok: true,
        success: true,
        modelUsed: outcome.modelUsed,
        fallbackUsed: outcome.fallbackUsed,
        department: extractedDepartment,
        items
      });
    } catch (err) {
      const inferredStatus = extractErrorStatus(err);
      const retryable = isRetryableGeminiError(err);
      const isAuthErr = isNonRetryableAuthOrConfigError(err);
      const httpStatus = isAuthErr ? 403 : inferredStatus === 429 ? 429 : err instanceof TimeoutError || inferredStatus === 504 ? 504 : retryable || inferredStatus === 503 || inferredStatus === 502 ? 503 : 500;
      const friendlyError = sanitizeExtractErrorMessage(err, httpStatus);
      console.error("[maf/extract-from-attachments] Returning error JSON:", httpStatus, friendlyError);
      if (!res.headersSent) {
        res.status(httpStatus).json({
          ok: false,
          success: false,
          retryable,
          error: friendlyError
        });
      }
    }
  });
  return router;
}
function apiJsonErrorMiddleware(err, _req, res, _next) {
  const statusCandidate = extractErrorStatus(err);
  const status = statusCandidate && statusCandidate >= 400 && statusCandidate <= 599 ? statusCandidate : err?.type === "entity.too.large" ? 413 : err?.type === "entity.parse.failed" ? 400 : 500;
  if (!res.headersSent) {
    res.status(status).json({
      ok: false,
      success: false,
      retryable: status === 503 || status === 429 || status === 504,
      error: sanitizeExtractErrorMessage(err, status)
    });
  }
}

// api/_app.ts
var app = express2();
app.use(express2.json({ limit: "12mb" }));
var apiRouter = createApiRouter();
app.use("/api", apiRouter);
app.use("/", apiRouter);
app.use("/api", (_req, res) => {
  res.status(404).json({ ok: false, error: "API endpoint not found." });
});
app.use(apiJsonErrorMiddleware);
function restoreVercelApiUrl(rawUrl, headers) {
  const safeUrl = rawUrl || "/";
  const qIdx = safeUrl.indexOf("?");
  const pathPart = qIdx >= 0 ? safeUrl.slice(0, qIdx) : safeUrl;
  const queryPart = qIdx >= 0 ? safeUrl.slice(qIdx + 1) : "";
  const params = new URLSearchParams(queryPart);
  const rewrittenPath = params.get("__api_path");
  if (rewrittenPath) {
    params.delete("__api_path");
    const cleanSubPath = rewrittenPath.startsWith("/") ? rewrittenPath : `/${rewrittenPath}`;
    const apiPath = cleanSubPath.startsWith("/api/") || cleanSubPath === "/api" ? cleanSubPath : `/api${cleanSubPath}`;
    const remainingQs = params.toString();
    return `${apiPath}${remainingQs ? `?${remainingQs}` : ""}`;
  }
  if (pathPart === "/api/index" || pathPart === "/index" || pathPart === "/") {
    const matched = typeof headers["x-matched-path"] === "string" && headers["x-matched-path"] || typeof headers["x-invoke-path"] === "string" && headers["x-invoke-path"] || typeof headers["x-forwarded-uri"] === "string" && headers["x-forwarded-uri"] || "";
    if (matched && matched !== "/api/index" && matched !== "/index" && matched !== "/") {
      const cleanMatched = matched.split("?")[0];
      const normalized = cleanMatched.startsWith("/api/") ? cleanMatched : `/api${cleanMatched.startsWith("/") ? "" : "/"}${cleanMatched}`;
      return `${normalized}${queryPart ? `?${queryPart}` : ""}`;
    }
  }
  return safeUrl;
}
function handler(req, res) {
  req.url = restoreVercelApiUrl(req.url, req.headers);
  return app(req, res);
}
export {
  app,
  handler as default,
  restoreVercelApiUrl
};
