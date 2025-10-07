import { currentUser } from "@clerk/nextjs/server";
import { db } from "./prisma";
import { dbLimit } from "./dbLimit";

export const checkUser = async () => {
  let user;

  try {
    user = await currentUser();
  } catch (err) {
    // If Clerk server helper fails (missing env, request context, etc.),
    // don't crash server rendering. Return null so callers can continue.
    console.error("checkUser: currentUser() failed:", err?.message || err);
    return null;
  }

  if (!user) return null;

  try {
    const loggedInUser = await dbLimit(() =>
      db.user.findUnique({
        where: {
          clerkUserId: user.id,
        },
      })
    );

    if (loggedInUser) return loggedInUser;

    const name = `${user.firstName || ""} ${user.lastName || ""}`.trim();
    const email = (user.emailAddresses && user.emailAddresses[0])
      ? user.emailAddresses[0].emailAddress
      : null;

    const newUser = await dbLimit(() =>
      db.user.create({
        data: {
          clerkUserId: user.id,
          name: name || null,
          imageUrl: user.imageUrl || null,
          email: email || null,
        },
      })
    );

    return newUser;
  } catch (error) {
    console.error("checkUser: DB upsert failed:", error?.message || error);
    return null;
  }
};
