// More than one cleaner on a cleaning. assignedTo stays the main cleaner (the
// email script, the Airbnb sync and older phones only know that one); crew
// holds everyone else. All of them see the job, can work it, and are paid the
// house's cleaner pay when it's finished.
//
// Pure (no React, no Firebase) so it runs under node --test.

export type CrewJob = { assignedTo?: string | null; assignedToName?: string | null; crew?: string[] | null };
type Person = { id: string; name: string };
type NameOf = (id: string) => string | null | undefined;

// Everyone on the cleaning, main cleaner first.
export function crewOf(job: CrewJob): string[] {
  const out: string[] = [];
  for (const id of [job.assignedTo, ...(job.crew || [])]) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function isOnCrew(job: CrewJob, id: string | null | undefined): boolean {
  return !!id && crewOf(job).includes(id);
}

// What gets written to the job. crew is null rather than [] when it's just one.
export type CrewChanges = { assignedTo: string | null; assignedToName: string | null; crew: string[] | null };

function changesFor(ids: string[], nameOf: NameOf): CrewChanges {
  const [lead, ...rest] = ids;
  return {
    assignedTo: lead || null,
    assignedToName: lead ? nameOf(lead) || "Cleaner" : null,
    crew: rest.length ? rest : null,
  };
}

// The job with this cleaner added. They're the main cleaner if nobody is yet.
export function addToCrew(job: CrewJob, person: Person, nameOf: NameOf): CrewChanges {
  const ids = crewOf(job);
  if (!ids.includes(person.id)) ids.push(person.id);
  return changesFor(ids, (id) => (id === person.id ? person.name : leadName(job, id) || nameOf(id)));
}

// The job with this cleaner taken off. If they were the main cleaner, the
// next one on the crew takes over.
export function removeFromCrew(job: CrewJob, id: string, nameOf: NameOf): CrewChanges {
  return changesFor(crewOf(job).filter((c) => c !== id), (c) => leadName(job, c) || nameOf(c));
}

function leadName(job: CrewJob, id: string): string | null {
  return id === job.assignedTo ? job.assignedToName || null : null;
}

// "Jewel Smith" for one cleaner; "Jewel & Shane", "Jewel, Shane & Pat" for more.
// Null when nobody is on it.
export function crewLabel(job: CrewJob, nameOf: NameOf): string | null {
  const ids = crewOf(job);
  if (ids.length === 0) return null;
  const names = ids.map((id) => leadName(job, id) || nameOf(id) || "Cleaner");
  if (names.length === 1) return names[0];
  const firsts = names.map((n) => n.split(" ")[0]);
  return `${firsts.slice(0, -1).join(", ")} & ${firsts[firsts.length - 1]}`;
}
