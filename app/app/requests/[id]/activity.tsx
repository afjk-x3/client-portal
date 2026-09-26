/** A request's timeline, newest first. Staff only. */
export function Activity({
  events,
  olderHidden,
}: {
  events: { id: number; actor: string; text: string; at: string }[];
  /** True when the page left out older events. */
  olderHidden: boolean;
}) {
  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-3">
      <h2 id="activity-heading" className="text-lg font-semibold">
        Activity
      </h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
      ) : (
        <ol className="flex flex-col gap-2 text-sm">
          {events.map((event) => (
            <li key={event.id}>
              <span className="font-medium">{event.actor}</span> {event.text}
              <span className="text-muted-foreground"> · {event.at}</span>
            </li>
          ))}
        </ol>
      )}
      {olderHidden && <p className="text-sm text-muted-foreground">Older events are not shown.</p>}
    </section>
  );
}
