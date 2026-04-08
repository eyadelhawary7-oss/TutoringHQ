import { supabaseAdmin } from '@/lib/supabase-admin';

export async function uploadOrderPdf(orderId: string, pdfBuffer: Buffer): Promise<string | null> {
  try {
    if (!supabaseAdmin) {
      console.error('[pdfStorage] Supabase admin not configured');
      return null;
    }

    const storagePath = `${orderId}.pdf`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('card-order-pdfs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('[pdfStorage] Upload failed:', uploadError.message);
      return null;
    }

    const { data, error: urlError } = await supabaseAdmin.storage
      .from('card-order-pdfs')
      .createSignedUrl(storagePath, 604800);

    if (urlError || !data?.signedUrl) {
      console.error('[pdfStorage] Signed URL failed:', urlError?.message);
      return null;
    }

    return data.signedUrl;
  } catch (err) {
    console.error('[pdfStorage] Unexpected error:', err);
    return null;
    // Never throw
  }
}
