-- Demo data for a local database (`supabase db reset` runs this file; `db push` never does).
-- Two sample businesses with services and one client each. They have no password,
-- so nobody can sign in to them until one is set.
do $$
declare
    dan_id uuid := 'a1111111-1111-1111-1111-111111111111'::uuid;
    maya_id uuid := 'b2222222-2222-2222-2222-222222222222'::uuid;
    s_haircut uuid := 'c1111111-1111-1111-1111-111111111111'::uuid;
    s_beard uuid := 'c2222222-2222-2222-2222-222222222222'::uuid;
    s_combo uuid := 'c3333333-3333-3333-3333-333333333333'::uuid;
    s_nails uuid := 'c4444444-4444-4444-4444-444444444444'::uuid;
    s_pedicure uuid := 'c5555555-5555-5555-5555-555555555555'::uuid;
    c_yossi uuid := 'd1111111-1111-1111-1111-111111111111'::uuid;
    c_noa uuid := 'd2222222-2222-2222-2222-222222222222'::uuid;
begin
    -- 1. Businesses
    insert into public.businesses (id, slug, name, owner_phone, working_hours)
    values 
    (
        dan_id,
        'barber-dan',
        'מספרת דניאל - Barber Dan',
        '0541234567',
        '{
            "sunday":    { "open": "09:00", "close": "19:00", "active": true },
            "monday":    { "open": "09:00", "close": "19:00", "active": true },
            "tuesday":   { "open": "09:00", "close": "19:00", "active": true },
            "wednesday": { "open": "09:00", "close": "19:00", "active": true },
            "thursday":  { "open": "09:00", "close": "20:00", "active": true },
            "friday":    { "open": "08:30", "close": "14:00", "active": true },
            "saturday":  { "open": "00:00", "close": "00:00", "active": false }
        }'::jsonb
    ),
    (
        maya_id,
        'maya-nails',
        'סטודיו מיה - ציפורניים ויופי',
        '0529876543',
        '{
            "sunday":    { "open": "09:30", "close": "18:30", "active": true },
            "monday":    { "open": "09:30", "close": "18:30", "active": true },
            "tuesday":   { "open": "09:30", "close": "18:30", "active": true },
            "wednesday": { "open": "09:30", "close": "18:30", "active": true },
            "thursday":  { "open": "09:30", "close": "19:30", "active": true },
            "friday":    { "open": "09:00", "close": "13:30", "active": true },
            "saturday":  { "open": "00:00", "close": "00:00", "active": false }
        }'::jsonb
    )
    on conflict (slug) do nothing;

    -- 2. Services for Barber Dan
    insert into public.services (id, business_id, name, duration_minutes, buffer_minutes, price)
    values
    (s_haircut, dan_id, 'תספורת גברים קלאסית', 30, 5, 80),
    (s_beard,   dan_id, 'עיצוב וסידור זקן', 20, 5, 45),
    (s_combo,   dan_id, 'חבילת VIP: תספורת + זקן + חפיפה', 50, 10, 115)
    on conflict (id) do nothing;

    -- Services for Maya Nails
    insert into public.services (id, business_id, name, duration_minutes, buffer_minutes, price)
    values
    (s_nails,    maya_id, 'לק ג''ל ומניקור', 60, 10, 140),
    (s_pedicure, maya_id, 'פדיקור ספא מפנק', 50, 10, 160)
    on conflict (id) do nothing;

    -- 3. Clients
    insert into public.clients (id, business_id, phone, first_name, last_name)
    values
    (c_yossi, dan_id, '0501234567', 'יוסי', 'כהן'),
    (c_noa,   maya_id, '0523334444', 'נועה', 'לוי')
    on conflict (business_id, phone) do nothing;

end $$;
