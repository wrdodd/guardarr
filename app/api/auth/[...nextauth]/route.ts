import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

// Log on module load
console.error("[NEXTAUTH] Module loaded at", new Date().toISOString(), "PID:", process.pid);

const authOptions = {
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Plex",
      credentials: {
        token: { label: "Plex Token", type: "text" },
      },
      async authorize(credentials, req) {
        console.error("[NEXTAUTH] ========== authorize() CALLED ==========");
        console.error("[NEXTAUTH] credentials keys:", credentials ? Object.keys(credentials) : "null");
        console.error("[NEXTAUTH] credentials.token exists:", !!credentials?.token);
        console.error("[NEXTAUTH] credentials.token length:", credentials?.token?.length || 0);
        console.error("[NEXTAUTH] credentials.token value:", credentials?.token ? credentials.token.substring(0, 8) + "..." : "EMPTY");
        
        try {
          const token = credentials?.token?.trim();
          
          if (!token) {
            console.error("[NEXTAUTH] ERROR: No token after trim");
            return null;
          }
          
          console.error("[NEXTAUTH] Calling Plex API with token length:", token.length);

          const response = await fetch("https://plex.tv/api/v2/user", {
            method: "GET",
            headers: {
              "Accept": "application/json",
              "X-Plex-Token": token,
              "X-Plex-Client-Identifier": "guardarr-web",
            },
          });

          console.error("[NEXTAUTH] Plex API response status:", response.status);

          if (!response.ok) {
            const errBody = await response.text();
            console.error("[NEXTAUTH] Plex API error body:", errBody.substring(0, 200));
            return null;
          }

          const body = await response.text();
          console.error("[NEXTAUTH] Plex API body length:", body.length);
          console.error("[NEXTAUTH] Plex API body starts with:", body.substring(0, 50));

          let userData: any = null;

          // Try JSON first (since we send Accept: application/json)
          if (body.trim().startsWith("{")) {
            console.error("[NEXTAUTH] Parsing as JSON");
            try {
              userData = JSON.parse(body);
              console.error("[NEXTAUTH] JSON parsed OK, id:", userData?.id, "username:", userData?.username);
            } catch (e: any) {
              console.error("[NEXTAUTH] JSON parse error:", e.message);
            }
          }

          // Fallback: XML
          if (!userData && body.trim().startsWith("<")) {
            console.error("[NEXTAUTH] Parsing as XML");
            const idMatch = body.match(/id="(\d+)"/);
            const usernameMatch = body.match(/username="([^"]*)"/);
            const emailMatch = body.match(/email="([^"]*)"/);
            const thumbMatch = body.match(/thumb="([^"]*)"/);
            const titleMatch = body.match(/title="([^"]*)"/);
            
            if (idMatch) {
              userData = {
                id: parseInt(idMatch[1]),
                username: usernameMatch?.[1] || titleMatch?.[1] || "",
                email: emailMatch?.[1] || "",
                thumb: thumbMatch?.[1] || "",
              };
              console.error("[NEXTAUTH] XML parsed OK, id:", userData.id, "username:", userData.username);
            } else {
              console.error("[NEXTAUTH] XML parse failed - no id found");
            }
          }

          if (!userData || !userData.id) {
            console.error("[NEXTAUTH] ERROR: No valid user data extracted");
            return null;
          }

          const user = {
            id: String(userData.id),
            name: userData.username || userData.title || userData.email || String(userData.id),
            email: userData.email || null,
            image: userData.thumb || null,
            plexToken: token,
          };

          console.error("[NEXTAUTH] SUCCESS! Returning user:", user.name, "(", user.id, ")");
          return user;

        } catch (error: any) {
          console.error("[NEXTAUTH] EXCEPTION in authorize():", error.message);
          console.error("[NEXTAUTH] Stack:", error.stack);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }: any) {
      console.error("[NEXTAUTH] jwt callback, hasUser:", !!user);
      if (user) {
        token.plexToken = user.plexToken;
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }: any) {
      console.error("[NEXTAUTH] session callback");
      if (token) {
        session.plexToken = token.plexToken;
        if (session.user) {
          session.user.id = token.id;
        }
      }
      return session;
    },
    async signIn({ user }: any) {
      console.error("[NEXTAUTH] signIn callback, user:", user?.name || "none");
      return true;
    },
  },
  pages: {
    signIn: "/login",
  },
  debug: true,
  session: {
    strategy: "jwt" as const,
    maxAge: 30 * 24 * 60 * 60,
  },
  secret: process.env.NEXTAUTH_SECRET || "guardarr-default-secret-change-in-production",
  logger: {
    error(code: string, metadata: any) {
      console.error("[NEXTAUTH-LIB] ERROR:", code, JSON.stringify(metadata));
    },
    warn(code: string) {
      console.error("[NEXTAUTH-LIB] WARN:", code);
    },
    debug(code: string, metadata: any) {
      console.error("[NEXTAUTH-LIB] DEBUG:", code, JSON.stringify(metadata));
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
