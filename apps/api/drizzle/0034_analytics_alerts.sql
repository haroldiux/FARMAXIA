-- F18 Module 11 (analytics): the scheduled shortage scan runs as farmaxia_platform across pharmacies.
-- It needs READ-ONLY access to what the stock velocity reads (sales, sale lines, returned lines and the catalog/cost
-- joins). No write access is granted here; stock_alerts already has its platform grants and policy (0033).
GRANT SELECT ON TABLE sales, sale_items, sale_return_items, products, product_presentations, presentation_costs TO farmaxia_platform;
CREATE POLICY sales_platform_read ON sales FOR SELECT TO farmaxia_platform USING (true);
CREATE POLICY sale_items_platform_read ON sale_items FOR SELECT TO farmaxia_platform USING (true);
CREATE POLICY sale_return_items_platform_read ON sale_return_items FOR SELECT TO farmaxia_platform USING (true);
CREATE POLICY products_platform_read ON products FOR SELECT TO farmaxia_platform USING (true);
CREATE POLICY product_presentations_platform_read ON product_presentations FOR SELECT TO farmaxia_platform USING (true);
CREATE POLICY presentation_costs_platform_read ON presentation_costs FOR SELECT TO farmaxia_platform USING (true);
