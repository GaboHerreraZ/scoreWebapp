-- Alerta para cuando la comisión de una venta no se puede causar.
--
-- La causación es best-effort a propósito: no puede tumbar el webhook de pago ni
-- impedir que el cliente reciba lo que compró. El precio de eso es que un fallo
-- queda solo en el log — la venta se cobra, el vendedor no ve su comisión y
-- nadie se entera hasta que reclama. Con esta alerta el admin lo ve en su bandeja
-- y puede reintentar la causación desde el panel de la empresa.
INSERT INTO "parameters" ("type", "code", "label", "description", "sort_order", "is_active", "created_at", "updated_at")
VALUES ('payment_alert_type', 'commission_accrual_failed', 'Comisión sin causar',
        'Una venta de empresa referida se pagó pero su comisión no pudo registrarse',
        5, true, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;
