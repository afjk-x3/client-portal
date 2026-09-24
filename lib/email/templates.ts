import { APP_NAME } from "@/lib/constants";
import { formatDate } from "@/lib/dates";

export type EmailContent = { subject: string; html: string; text: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Absolute link to an app page. Emails never link to auth tokens. */
export function siteUrl(path: string): string {
  return new URL(path, process.env.NEXT_PUBLIC_SITE_URL).toString();
}

function subjectLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/** Wraps already-escaped HTML paragraphs and one link. */
function html(paragraphs: string[], link: { href: string; label: string }): string {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join("");
  return (
    `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">` +
    `${body}<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p></div>`
  );
}

function list(values: string[]): string {
  return `<ul>${values.map((v) => `<li>${escapeHtml(v)}</li>`).join("")}</ul>`;
}

export function staffAddedEmail(input: { firmName: string; adminName: string }): EmailContent {
  const link = siteUrl("/login");
  return {
    subject: subjectLine(`You've been added to ${input.firmName}`),
    html: html(
      [
        `${escapeHtml(input.adminName)} added you to <strong>${escapeHtml(input.firmName)}</strong> on ${APP_NAME}.`,
        "Sign in with your email address. We'll send you a 6-digit code.",
      ],
      { href: link, label: "Sign in" },
    ),
    text: `${input.adminName} added you to ${input.firmName} on ${APP_NAME}.\n\nSign in with your email address: ${link}`,
  };
}

export function requestSentEmail(input: {
  firmName: string;
  title: string;
  dueDate: string;
  itemCount: number;
  requestId: string;
}): EmailContent {
  const link = siteUrl(`/portal/requests/${input.requestId}`);
  const due = formatDate(input.dueDate);
  const items = input.itemCount === 1 ? "1 item" : `${input.itemCount} items`;
  return {
    subject: subjectLine(`${input.firmName} needs documents from you: ${input.title}`),
    html: html(
      [
        `${escapeHtml(input.firmName)} sent you a request: <strong>${escapeHtml(input.title)}</strong>.`,
        `It has ${items} and is due ${escapeHtml(due)}.`,
      ],
      { href: link, label: "Open the request" },
    ),
    text: `${input.firmName} sent you a request: ${input.title}.\nIt has ${items} and is due ${due}.\n\nOpen the request: ${link}`,
  };
}

export function needsChangesEmail(input: {
  firmName: string;
  itemTitle: string;
  note: string;
  requestId: string;
}): EmailContent {
  const link = siteUrl(`/portal/requests/${input.requestId}`);
  return {
    subject: subjectLine(`Changes needed: ${input.itemTitle}`),
    html: html(
      [
        `${escapeHtml(input.firmName)} asked for changes to <strong>${escapeHtml(input.itemTitle)}</strong>:`,
        escapeHtml(input.note),
      ],
      { href: link, label: "Open the request" },
    ),
    text: `${input.firmName} asked for changes to ${input.itemTitle}:\n\n${input.note}\n\nOpen the request: ${link}`,
  };
}

export function reminderEmail(input: {
  firmName: string;
  title: string;
  dueDate: string;
  overdue: boolean;
  openItems: string[];
  requestId: string;
}): EmailContent {
  const link = siteUrl(`/portal/requests/${input.requestId}`);
  const due = formatDate(input.dueDate);
  const when = input.overdue ? `was due ${due}` : `is due ${due}`;
  return {
    subject: subjectLine(`Reminder: ${input.title} ${when}`),
    html: html(
      [
        `${escapeHtml(input.firmName)} is still waiting on these items for <strong>${escapeHtml(input.title)}</strong>, which ${escapeHtml(when)}:`,
        list(input.openItems),
      ],
      { href: link, label: "Open the request" },
    ),
    text:
      `${input.firmName} is still waiting on these items for ${input.title}, which ${when}:\n\n` +
      input.openItems.map((item) => `- ${item}`).join("\n") +
      `\n\nOpen the request: ${link}`,
  };
}

export type DigestGroup = {
  clientName: string;
  requestTitle: string;
  requestId: string;
  items: string[];
};

export function staffDigestEmail(input: { firmName: string; groups: DigestGroup[] }): EmailContent {
  const count = input.groups.reduce((sum, group) => sum + group.items.length, 0);
  const noun = count === 1 ? "item" : "items";
  const dashboard = siteUrl("/app");
  return {
    subject: subjectLine(`${count} ${noun} submitted at ${input.firmName}`),
    html: html(
      [
        `Clients submitted ${count} ${noun} since the last digest:`,
        ...input.groups.map(
          (group) =>
            `<a href="${escapeHtml(siteUrl(`/app/requests/${group.requestId}`))}">` +
            `${escapeHtml(group.clientName)}: ${escapeHtml(group.requestTitle)}</a>${list(group.items)}`,
        ),
      ],
      { href: dashboard, label: "Open the dashboard" },
    ),
    text:
      `Clients submitted ${count} ${noun} since the last digest:\n\n` +
      input.groups
        .map(
          (group) =>
            `${group.clientName}: ${group.requestTitle}\n${siteUrl(`/app/requests/${group.requestId}`)}\n` +
            group.items.map((item) => `- ${item}`).join("\n"),
        )
        .join("\n\n") +
      `\n\nOpen the dashboard: ${dashboard}`,
  };
}
