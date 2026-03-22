import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'centerhq-respond-io-onboarding' });
}

export async function POST(request: NextRequest) {
  await request.json().catch(() => ({}));
  return NextResponse.json({ received: true });
}
