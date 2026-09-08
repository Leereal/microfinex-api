-- =====================================================
-- SEED DATA: AI Providers
-- =====================================================

INSERT INTO "ai_providers" ("id", "name", "displayName", "baseUrl", "isActive", "isLocal", "capabilities", "createdAt", "updatedAt") VALUES
    ('550e8400-e29b-41d4-a716-446655440001', 'gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com', true, false, ARRAY['document_extraction', 'image_analysis', 'text_generation', 'structured_output'], NOW(), NOW()),
    ('550e8400-e29b-41d4-a716-446655440002', 'claude', 'Anthropic Claude', 'https://api.anthropic.com', true, false, ARRAY['document_extraction', 'image_analysis', 'text_generation', 'structured_output'], NOW(), NOW()),
    ('550e8400-e29b-41d4-a716-446655440003', 'openai', 'OpenAI GPT', 'https://api.openai.com', true, false, ARRAY['document_extraction', 'image_analysis', 'text_generation', 'structured_output'], NOW(), NOW()),
    ('550e8400-e29b-41d4-a716-446655440004', 'deepseek', 'DeepSeek', 'https://api.deepseek.com', true, false, ARRAY['document_extraction', 'text_generation', 'structured_output'], NOW(), NOW()),
    ('550e8400-e29b-41d4-a716-446655440005', 'ollama', 'Ollama (Local)', 'http://localhost:11434', true, true, ARRAY['document_extraction', 'image_analysis', 'text_generation'], NOW(), NOW())
ON CONFLICT (name) DO UPDATE SET
    "displayName" = EXCLUDED."displayName",
    "baseUrl" = EXCLUDED."baseUrl",
    "isActive" = EXCLUDED."isActive",
    "isLocal" = EXCLUDED."isLocal",
    "capabilities" = EXCLUDED."capabilities",
    "updatedAt" = NOW();

-- =====================================================
-- SEED DATA: Default Document Types (Per Organization - Placeholder)
-- Run this with specific organizationId after creating organizations
-- =====================================================
-- Example: Create document types for a specific organization
-- Replace 'YOUR_ORG_ID' with actual organization UUID

-- INSERT INTO "document_types" ("id", "organizationId", "name", "code", "description", "isRequired", "isActive", "sortOrder", "validityDays", "createdAt", "updatedAt") VALUES
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'National ID', 'ID', 'Zimbabwe National Identity Card', true, true, 1, NULL, NOW(), NOW()),
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Passport', 'PASSPORT', 'Valid Passport', false, true, 2, NULL, NOW(), NOW()),
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Proof of Address', 'POA', 'Utility bill or bank statement showing residential address', true, true, 3, 90, NOW(), NOW()),
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Bank Statement', 'BANK_STATEMENT', '3-month bank statement', false, true, 4, 30, NOW(), NOW()),
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Payslip', 'PAYSLIP', 'Recent payslip (last 3 months)', false, true, 5, 30, NOW(), NOW()),
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Business Registration', 'BIZ_REG', 'CR6 or Certificate of Incorporation', false, true, 6, NULL, NOW(), NOW()),
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Profile Picture', 'PROFILE_PIC', 'Client photograph', true, true, 7, NULL, NOW(), NOW()),
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Loan Application Form', 'APPLICATION', 'Signed loan application form', false, true, 8, NULL, NOW(), NOW())
-- ON CONFLICT (organizationId, code) DO UPDATE SET
--     "name" = EXCLUDED."name",
--     "description" = EXCLUDED."description",
--     "isRequired" = EXCLUDED."isRequired",
--     "sortOrder" = EXCLUDED."sortOrder",
--     "validityDays" = EXCLUDED."validityDays",
--     "updatedAt" = NOW();

-- =====================================================
-- SEED DATA: Default Collateral Types (Per Organization - Placeholder)
-- =====================================================

-- INSERT INTO "collateral_types" ("id", "organizationId", "name", "code", "description", "isActive", "sortOrder", "requiredFields", "createdAt", "updatedAt") VALUES
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Motor Vehicle', 'VEHICLE', 'Cars, trucks, motorcycles', true, 1, ARRAY['registration_number', 'make', 'model', 'year'], NOW(), NOW()),
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Real Estate Property', 'PROPERTY', 'Land, houses, commercial buildings', true, 2, ARRAY['location', 'title_deed_number'], NOW(), NOW()),
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Equipment', 'EQUIPMENT', 'Machinery, tools, office equipment', true, 3, ARRAY['serial_number', 'make', 'model'], NOW(), NOW()),
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Inventory', 'INVENTORY', 'Stock, raw materials, finished goods', true, 4, ARRAY['description', 'quantity'], NOW(), NOW()),
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Accounts Receivable', 'RECEIVABLES', 'Outstanding invoices, debtors', true, 5, ARRAY['debtor_name', 'invoice_details'], NOW(), NOW()),
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Securities', 'SECURITIES', 'Shares, bonds, investments', true, 6, ARRAY['security_type', 'certificate_number'], NOW(), NOW()),
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Livestock', 'LIVESTOCK', 'Cattle, goats, poultry', true, 7, ARRAY['animal_type', 'quantity', 'brand'], NOW(), NOW()),
--     (gen_random_uuid(), 'YOUR_ORG_ID', 'Other', 'OTHER', 'Other valuable assets', true, 8, ARRAY['description'], NOW(), NOW())
-- ON CONFLICT (organizationId, code) DO UPDATE SET
--     "name" = EXCLUDED."name",
--     "description" = EXCLUDED."description",
--     "sortOrder" = EXCLUDED."sortOrder",
--     "requiredFields" = EXCLUDED."requiredFields",
--     "updatedAt" = NOW();
