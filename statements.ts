// Monthly statements for hosts who pay us directly (a house with billedFrom):
// each finished cleaning that month, its price, whether it's paid, and what's
// still owed. A host with several houses (the same forwarding address) gets
// one statement for all of them.
//
// Pure (no React, no Firebase) so it runs under node --test.

import { isDeepClean, jobPrice, type HouseJobs, type MoneyJob } from "./money.ts";
import { countsAsCleaning } from "./schedule.ts";
import { formatShortDate, jobDateKey } from "./turnover.ts";

export type StatementLine = { jobId: string; dateKey: string; house: string; type: string; price: number | null; paid: boolean };

export type Statement = {
  key: string;
  // "Canyon Rock Paradise", or "Canyon Rock Paradise + 4 more".
  label: string;
  houses: string[];
  lines: StatementLine[];
  // This month, priced cleanings only.
  total: number;
  paid: number;
  owed: number;
  unpriced: number;
  // Unpaid from months before this one.
  earlierOwed: number;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "November 2026" for "2026-11".
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1] || ""} ${y}`.trim();
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// One statement per host that billed anything, for the month "YYYY-MM".
export function statementsFor(groups: HouseJobs<MoneyJob & { id: string }>[], month: string): Statement[] {
  const byHost = new Map<string, HouseJobs<MoneyJob & { id: string }>[]>();
  for (const g of groups) {
    const house = g.house;
    if (!house?.billedFrom) continue;
    const key = (house.forwardsFrom || "").toLowerCase() || `house:${house.name}`;
    if (!byHost.has(key)) byHost.set(key, []);
    (byHost.get(key) as HouseJobs<MoneyJob & { id: string }>[]).push(g);
  }
  const out: Statement[] = [];
  for (const [key, list] of byHost) {
    const houses = list.map((g) => g.house?.short || g.house?.name || "");
    const st: Statement = {
      key,
      label: houses.length === 1 ? houses[0] : `${houses[0]} + ${houses.length - 1} more`,
      houses,
      lines: [],
      total: 0, paid: 0, owed: 0, unpriced: 0, earlierOwed: 0,
    };
    for (const g of list) {
      const house = g.house;
      if (!house?.billedFrom) continue;
      for (const job of g.jobs) {
        if (!countsAsCleaning(job) || !job.done) continue;
        const day = jobDateKey(job);
        if (!day || day < house.billedFrom) continue;
        const price = jobPrice(job, house);
        const paid = job.hostPaid === true;
        if (day.slice(0, 7) === month) {
          st.lines.push({
            jobId: String(job.id), dateKey: day, house: house.short || house.name,
            type: isDeepClean(job) ? "Deep clean" : job.type || "Cleaning", price, paid,
          });
          if (price === null) st.unpriced += 1;
          else {
            st.total += price;
            if (paid) st.paid += price; else st.owed += price;
          }
        } else if (day.slice(0, 7) < month && !paid && price !== null) {
          st.earlierOwed += price;
        }
      }
    }
    st.lines.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
    st.total = round(st.total);
    st.paid = round(st.paid);
    st.owed = round(st.owed);
    st.earlierOwed = round(st.earlierOwed);
    if (st.lines.length || st.earlierOwed) out.push(st);
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function dollars(n: number): string {
  return `$${n.toFixed(2).replace(/\.00$/, "")}`;
}

// The statement as a message to send the host.
export function statementText(st: Statement, month: string, business: { name: string; phone: string }): string {
  const name = monthName(month);
  const lines = [`${business.name} · statement for ${name}`, st.houses.join(", "), ""];
  if (st.lines.length === 0) lines.push(`No cleanings in ${name}.`);
  for (const l of st.lines) {
    const price = l.price === null ? "price to be confirmed" : dollars(l.price);
    lines.push(`${formatShortDate(l.dateKey)} · ${st.houses.length > 1 ? `${l.house} · ` : ""}${l.type} · ${price}${l.price !== null ? (l.paid ? " · paid" : "") : ""}`);
  }
  lines.push("");
  lines.push(`Total for ${name}: ${dollars(st.total)}`);
  if (st.paid) lines.push(`Paid: ${dollars(st.paid)}`);
  lines.push(`Still owed: ${dollars(st.owed)}`);
  if (st.earlierOwed) lines.push(`Also owed from earlier months: ${dollars(st.earlierOwed)}`);
  if (st.unpriced) lines.push(`${st.unpriced} cleaning${st.unpriced === 1 ? "" : "s"} not priced yet, left out of the total.`);
  lines.push("", `Questions? ${business.phone}`);
  return lines.join("\n");
}
