export const busyResponse = () => Response.json({ error: "Another job is still running." }, { status: 409 });

export const errorResponse = (error: string, status: number) => Response.json({ error }, { status });
