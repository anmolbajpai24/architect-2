export const busyResponse = () => Response.json({ error: "Another job is still running." }, { status: 409 });

export const errorResponse = (error: string, status: number) => Response.json({ error }, { status });

/** The viewer may not open this project. 403, never 404: pretending it doesn't exist would be a different lie. */
export const forbiddenResponse = (err: unknown) => errorResponse(err instanceof Error ? err.message : "Not allowed.", 403);

/** A route's project selector named nothing: a 404 in the user's language, not a stack trace. */
export const notFoundResponse = (err: unknown) => errorResponse(err instanceof Error ? err.message : "Not found.", 404);
