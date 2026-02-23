import { auth } from "@clerk/nextjs/server";

export default async function Home() {
  const { userId } = await auth();

  return (
    <section className="content">
      <h1 style={{ marginTop: 0, color: "#f4f6fb" }}>Auth Ready</h1>
      <p style={{ marginBottom: "0.5rem" }}>
        This Next.js App Router service is ready for Clerk authentication.
      </p>
      <p style={{ marginBottom: 0 }}>
        Current user: {userId ? userId : "Signed out"}
      </p>
    </section>
  );
}
