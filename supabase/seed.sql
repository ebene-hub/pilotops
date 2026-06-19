-- Pilot Ops — seed CONFIG defaults only (no dummy people, flights, or fleet).
-- Operational data is created by real users through the app.

-- Roles (operational crew + access roles). Admins edit these in the console.
insert into roles (name, description, permissions) values
  ('Pilot',             'Flies missions; logs flights and incidents.',          '["flight.create","incident.create","media.upload"]'),
  ('Co-pilot',          'Assists the pilot in command.',                        '["incident.create","media.upload"]'),
  ('GIS Analyst',       'Analyses captured imagery and maps (no Pilot Ops login).', '["media.upload","incident.create"]'),
  ('Mission Commander', 'Owns a mission; assigns crew.',                        '["flight.create","incident.create","report.create","media.upload"]'),
  ('Safety Officer',    'Reviews emergencies and compliance.',                  '["emergency.review","audit.read","incident.create"]'),
  ('Observer',          'Read-only situational awareness.',                     '[]'),
  ('Maintenance Tech',  'Maintains aircraft and batteries.',                    '["battery.update","fleet.manage"]'),
  ('Dispatcher',        'Coordinates flights and notifications.',               '["flight.create","incident.create"]'),
  ('Director',          'Full administrative control.',                         '["*"]'),
  ('Stakeholder',       'External recipient of notifications only.',            '[]')
on conflict (name) do nothing;

-- Sector presets (vocab + units). 'generic' is the active default.
insert into sectors (id, label, units, incident_types, sample_places, active) values
  ('generic',  'Multi-sector',          '{"area":"km²","asset":"asset"}',
     '["Anomaly","Breach","Wildlife","Equipment","Personnel"]', '[]', true),
  ('pipeline', 'Pipeline monitoring',   '{"area":"km","asset":"valve"}',
     '["Leak","Encroachment","Corrosion","Vandalism","Vegetation"]', '[]', false),
  ('utility',  'Power line inspection', '{"area":"km","asset":"tower"}',
     '["Hot spot","Tree fall","Insulator damage","Conductor sag","Tower lean"]', '[]', false),
  ('agriculture','Precision agriculture','{"area":"ha","asset":"field"}',
     '["Pest","Disease","Drought stress","Nutrient deficiency","Lodging"]', '[]', false)
on conflict (id) do nothing;

-- Mission-form field configuration (admin can switch dropdown <-> free text).
insert into form_field_config (key, type, options) values
  ('coverageArea',  'text',     '[]'),
  ('purpose',       'dropdown', '["Routine inspection","Incident follow-up","Scheduled survey","Emergency response","Training"]'),
  ('flightStation', 'dropdown', '[]'),
  ('uav',           'dropdown', '[]')
on conflict (key) do nothing;

-- Mission purposes (lookup for the dropdown above).
insert into purposes (name, sort) values
  ('Routine inspection', 1), ('Incident follow-up', 2), ('Scheduled survey', 3),
  ('Emergency response', 4), ('Training', 5)
on conflict do nothing;
