-- RPC for AI natural language query: execute validated SELECT with center_id parameter
CREATE OR REPLACE FUNCTION public.ai_execute_query(p_sql text, p_center_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(sub)), ''[]''::jsonb) FROM (%s) sub', p_sql)
  USING p_center_id
  INTO result;
  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.ai_execute_query(text, uuid) IS 'Execute validated SELECT for AI natural language queries. center_id passed as $1.';
