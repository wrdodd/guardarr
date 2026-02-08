import "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    plexToken: string;
  }

  interface Session {
    plexToken?: string;
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    plexToken?: string;
  }
}
