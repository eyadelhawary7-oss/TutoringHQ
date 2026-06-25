-- Localized holiday labels: English UI uses english_name; Arabic UI uses name.
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS english_name TEXT;

-- Order: more specific patterns first (approximate vs fixed dates).
UPDATE holidays SET english_name = 'Eid al-Fitr (approx)'
  WHERE name ILIKE '%فطر%' AND (name ILIKE '%تقريبي%' OR name ILIKE '%تقريبى%');

UPDATE holidays SET english_name = 'Eid al-Adha (approx)'
  WHERE name ILIKE '%أضحى%' AND (name ILIKE '%تقريبي%' OR name ILIKE '%تقريبى%');

UPDATE holidays SET english_name = 'Prophet''s Birthday (approx)'
  WHERE name ILIKE '%المولد%' AND (name ILIKE '%تقريبي%' OR name ILIKE '%تقريبى%');

UPDATE holidays SET english_name = 'Coptic Christmas'
  WHERE name ILIKE '%الميلاد المجيد%';

UPDATE holidays SET english_name = 'January 25 Revolution'
  WHERE name ILIKE '%25 يناير%' OR name ILIKE '%يناير 25%';

UPDATE holidays SET english_name = 'Eid al-Fitr'
  WHERE name ILIKE '%فطر%' AND english_name IS NULL;

UPDATE holidays SET english_name = 'Sinai Liberation Day'
  WHERE name ILIKE '%سيناء%';

UPDATE holidays SET english_name = 'Labour Day'
  WHERE name ILIKE '%العمال%' OR name ILIKE '%عمال%';

UPDATE holidays SET english_name = 'Eid al-Adha'
  WHERE name ILIKE '%أضحى%' AND english_name IS NULL;

UPDATE holidays SET english_name = 'June 30 Revolution'
  WHERE name ILIKE '%30 يونيو%' OR name ILIKE '%يونيو%';

UPDATE holidays SET english_name = 'Revolution Day'
  WHERE name ILIKE '%عيد الثورة%';

UPDATE holidays SET english_name = 'Prophet''s Birthday'
  WHERE name ILIKE '%المولد%' AND english_name IS NULL;

UPDATE holidays SET english_name = 'Armed Forces Day'
  WHERE name ILIKE '%القوات المسلحة%';

COMMENT ON COLUMN holidays.english_name IS 'English display name for /en UI; name remains Arabic (or primary) label for /ar';
