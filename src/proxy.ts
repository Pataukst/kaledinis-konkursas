import { NextRequest, NextResponse } from "next/server";
import { validSiteCredentials } from "./lib/site-access";

export function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Website access password has not been configured.", { status: 503 });
  }
  if (validSiteCredentials(request.headers.get("authorization"), password))
    return NextResponse.next();
  return new NextResponse("Enter the team username and website password.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Christmas contest team", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export const config = { matcher: "/:path*" };
