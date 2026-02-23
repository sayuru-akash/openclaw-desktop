import { auth } from "@clerk/nextjs/server";

export default async function Home() {
  const { userId } = await auth();

  return (
    <div className="home-card">
      <p>OpenClaw Desktop authentication service.</p>
      <span className={`status-badge ${userId ? "signed-in" : "signed-out"}`}>
        {userId ? "Signed in" : "Signed out"}
      </span>
    </div>
  );
}
