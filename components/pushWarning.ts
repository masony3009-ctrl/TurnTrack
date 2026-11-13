import { alertSoon } from "./ui";

// A notification that reached none of a cleaner's phones (no app, signed out,
// notifications off) leaves them not knowing. Tell the owner, once for the
// whole batch, so they can text instead. Fire and forget, like the pushes.
export function warnUnreached(sends: { name: string; reached: Promise<number> }[], about: string): void {
  if (sends.length === 0) return;
  Promise.all(sends.map(s => s.reached.then(n => (n > 0 ? null : s.name.split(" ")[0])).catch(() => s.name.split(" ")[0])))
    .then(names => {
      const missed = names.filter((n): n is string => !!n);
      if (missed.length === 0) return;
      const who = missed.length === 1 ? missed[0] : `${missed.slice(0, -1).join(", ")} and ${missed[missed.length - 1]}`;
      alertSoon(
        `${who} didn't get the notification`,
        `${missed.length === 1 ? "Their phone isn't" : "Their phones aren't"} getting TurnTrack notifications right now. Text ${missed.length === 1 ? "them" : "each of them"} about ${about}.`
      );
    });
}
