import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'centerhq-respond-io-onboarding' });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  console.log('[Respond.io inbound]', JSON.stringify(body));
  return NextResponse.json({ received: true });
}
