-- Nex Tedarik Pazarı - Kritik Stok Ön Kontrol
-- SALT OKUNUR: Veritabanında hiçbir değişiklik yapmaz.

WITH expected(table_name, column_name, expected_type) AS (
    VALUES
    ('Product', 'minStockThreshold', 'integer'),
    ('Product', 'stockAlertActive', 'boolean'),
    ('ProductVariant', 'minStockThreshold', 'integer'),
    ('ProductVariant', 'stockAlertActive', 'boolean')
)
SELECT
    e.table_name,
    e.column_name,
    CASE
        WHEN c.column_name IS NULL THEN 'EKSIK'
        WHEN c.data_type <> e.expected_type THEN 'UYUMSUZ_TUR'
        WHEN e.column_name = 'stockAlertActive'
             AND (
                 c.is_nullable <> 'NO'
                 OR LOWER(TRIM(c.column_default)) NOT IN
                    ('false', 'false::boolean')
             )
             THEN 'UYUMSUZ_DEFAULT'
        WHEN e.column_name = 'minStockThreshold'
             AND c.is_nullable <> 'YES'
             THEN 'UYUMSUZ_NULL'
        ELSE 'HAZIR'
    END AS kontrol_sonucu,
    c.data_type,
    c.is_nullable,
    c.column_default
FROM expected e
LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema()
   AND c.table_name = e.table_name
   AND c.column_name = e.column_name
ORDER BY e.table_name, e.column_name;
