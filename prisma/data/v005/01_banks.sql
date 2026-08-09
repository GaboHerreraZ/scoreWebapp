-- Extend the 'bank' parameter catalog with the financial institutions
-- available through PSE (ACH Colombia): banks, compañías de financiamiento,
-- cooperativas financieras and SEDPEs/neobancos.
--
-- Source: PSE financial-institution roster (cross-checked against the
-- GET_BANKS_LIST responses of the PSE-integrated gateways, 2026-08).
-- Excluded on purpose: fiduciarias (Acción/Alianza Fiduciaria) and payment
-- aggregators (Paycash) — they don't hold savings/checking accounts, and this
-- catalog feeds the company bank-account selector used by the promissory note.
--
-- The two seeded rows keep their codes ('bancolombia', 'bancoBogota') so the
-- ON CONFLICT clause only refreshes their label/sort_order — existing FK
-- references from companies.account_bank are untouched.
--
-- sort_order is alphabetical by label. UPSERT on (type, code): idempotent,
-- safe to re-run on staging and prod. The runner (apply-data-migrations.js)
-- wraps the whole file in a transaction, so no BEGIN/COMMIT here.

INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at") VALUES
  ('bank', 'addi',                 'ADDI',                                     NULL, true, 1,  NOW(), NOW()),
  ('bank', 'ban100',               'Ban100',                                   NULL, true, 2,  NOW(), NOW()),
  ('bank', 'bancamia',             'Bancamía',                                 NULL, true, 3,  NOW(), NOW()),
  ('bank', 'bancoAgrario',         'Banco Agrario',                            NULL, true, 4,  NOW(), NOW()),
  ('bank', 'bancoAvVillas',        'Banco AV Villas',                          NULL, true, 5,  NOW(), NOW()),
  ('bank', 'bancoCajaSocial',      'Banco Caja Social',                        NULL, true, 6,  NOW(), NOW()),
  ('bank', 'bancoContactar',       'Banco Contactar',                          NULL, true, 7,  NOW(), NOW()),
  ('bank', 'bancoCoopcentral',     'Banco Cooperativo Coopcentral',            NULL, true, 8,  NOW(), NOW()),
  ('bank', 'davivienda',           'Banco Davivienda',                         NULL, true, 9,  NOW(), NOW()),
  ('bank', 'bancoBogota',          'Banco de Bogotá',                          NULL, true, 10, NOW(), NOW()),
  ('bank', 'bancoOccidente',       'Banco de Occidente',                       NULL, true, 11, NOW(), NOW()),
  ('bank', 'bancoFalabella',       'Banco Falabella',                          NULL, true, 12, NOW(), NOW()),
  ('bank', 'bancoFinandina',       'Banco Finandina',                          NULL, true, 13, NOW(), NOW()),
  ('bank', 'bancoGnbSudameris',    'Banco GNB Sudameris',                      NULL, true, 14, NOW(), NOW()),
  ('bank', 'bancoJpMorgan',        'Banco J.P. Morgan Colombia',               NULL, true, 15, NOW(), NOW()),
  ('bank', 'bancoMundoMujer',      'Banco Mundo Mujer',                        NULL, true, 16, NOW(), NOW()),
  ('bank', 'bancoPichincha',       'Banco Pichincha',                          NULL, true, 17, NOW(), NOW()),
  ('bank', 'bancoPopular',         'Banco Popular',                            NULL, true, 18, NOW(), NOW()),
  ('bank', 'bancoSantander',       'Banco Santander Colombia',                 NULL, true, 19, NOW(), NOW()),
  ('bank', 'bancoSerfinanza',      'Banco Serfinanza',                         NULL, true, 20, NOW(), NOW()),
  ('bank', 'bancoUnion',           'Banco Unión Colombiano',                   NULL, true, 21, NOW(), NOW()),
  ('bank', 'bancoW',               'Banco W',                                  NULL, true, 22, NOW(), NOW()),
  ('bank', 'bancolombia',          'Bancolombia',                              NULL, true, 23, NOW(), NOW()),
  ('bank', 'bancoomeva',           'Bancoomeva',                               NULL, true, 24, NOW(), NOW()),
  ('bank', 'bbva',                 'BBVA Colombia',                            NULL, true, 25, NOW(), NOW()),
  ('bank', 'bold',                 'Bold CF',                                  NULL, true, 26, NOW(), NOW()),
  ('bank', 'citibank',             'Citibank Colombia',                        NULL, true, 27, NOW(), NOW()),
  ('bank', 'coink',                'Coink',                                    NULL, true, 28, NOW(), NOW()),
  ('bank', 'coltefinanciera',      'Coltefinanciera',                          NULL, true, 29, NOW(), NOW()),
  ('bank', 'confiar',              'Confiar Cooperativa Financiera',           NULL, true, 30, NOW(), NOW()),
  ('bank', 'coofinep',             'Coofinep Cooperativa Financiera',          NULL, true, 31, NOW(), NOW()),
  ('bank', 'cotrafa',              'Cooperativa Financiera Cotrafa',           NULL, true, 32, NOW(), NOW()),
  ('bank', 'cfa',                  'Cooperativa Financiera de Antioquia (CFA)',NULL, true, 33, NOW(), NOW()),
  ('bank', 'crezcamos',            'Crezcamos',                                NULL, true, 34, NOW(), NOW()),
  ('bank', 'dale',                 'Dale',                                     NULL, true, 35, NOW(), NOW()),
  ('bank', 'daviplata',            'Daviplata',                                NULL, true, 36, NOW(), NOW()),
  ('bank', 'ding',                 'Ding Tecnipagos',                          NULL, true, 37, NOW(), NOW()),
  ('bank', 'financieraJuriscoop',  'Financiera Juriscoop',                     NULL, true, 38, NOW(), NOW()),
  ('bank', 'global66',             'Global66',                                 NULL, true, 39, NOW(), NOW()),
  ('bank', 'iris',                 'Iris',                                     NULL, true, 40, NOW(), NOW()),
  ('bank', 'itau',                 'Itaú',                                     NULL, true, 41, NOW(), NOW()),
  ('bank', 'jfk',                  'JFK Cooperativa Financiera',               NULL, true, 42, NOW(), NOW()),
  ('bank', 'luloBank',             'Lulo Bank',                                NULL, true, 43, NOW(), NOW()),
  ('bank', 'mibanco',              'Mibanco',                                  NULL, true, 44, NOW(), NOW()),
  ('bank', 'movii',                'Movii',                                    NULL, true, 45, NOW(), NOW()),
  ('bank', 'nequi',                'Nequi',                                    NULL, true, 46, NOW(), NOW()),
  ('bank', 'nu',                   'Nu',                                       NULL, true, 47, NOW(), NOW()),
  ('bank', 'olimpicaPay',          'Olimpica Pay',                             NULL, true, 48, NOW(), NOW()),
  ('bank', 'powwi',                'Powwi',                                    NULL, true, 49, NOW(), NOW()),
  ('bank', 'rappipay',             'RappiPay',                                 NULL, true, 50, NOW(), NOW()),
  ('bank', 'revolut',              'Revolut Colombia',                         NULL, true, 51, NOW(), NOW()),
  ('bank', 'santanderConsumer',    'Santander Consumer Colombia',              NULL, true, 52, NOW(), NOW()),
  ('bank', 'scotiabankColpatria',  'Scotiabank Colpatria',                     NULL, true, 53, NOW(), NOW()),
  ('bank', 'uala',                 'Ualá',                                     NULL, true, 54, NOW(), NOW())
ON CONFLICT ("type", "code") DO UPDATE
  SET "label" = EXCLUDED."label",
      "description" = EXCLUDED."description",
      "is_active" = EXCLUDED."is_active",
      "sort_order" = EXCLUDED."sort_order",
      "updated_at" = NOW();
