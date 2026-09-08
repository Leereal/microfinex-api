-- =====================================================
-- CLIENT MANAGEMENT SYSTEM ENHANCEMENT
-- Phase 1: Database Schema Migration
-- Date: December 2024
-- =====================================================

-- Note: This is a reference SQL file. 
-- The actual migration will be handled by Prisma migrate.
-- Run: npx prisma migrate dev --name client_management_enhancement

-- New Tables to be created:
-- 1. document_types - Document type definitions per organization
-- 2. ai_providers - Available AI providers for document extraction
-- 3. organization_ai_configs - Organization-specific AI settings
-- 4. client_addresses - Full address information
-- 5. client_contacts - Multiple contacts per client
-- 6. client_documents - Document storage metadata
-- 7. client_businesses - Business information for business clients
-- 8. collateral_types - Acceptable collateral types per organization
-- 9. client_collaterals - Client collateral items
-- 10. import_jobs - CSV/Excel import tracking

-- Enhanced Tables:
-- 1. clients - Additional fields for comprehensive client data
-- 2. next_of_kins - Enhanced with more contact details
-- 3. client_limits - Already exists, will be enhanced

-- This migration adds support for:
-- - Multi-currency client limits (Zimbabwe: USD, ZWL, ZAR, BWP)
-- - Multiple contact numbers with WhatsApp flags
-- - Full address with suburb/city filtering
-- - Document management with MinIO integration
-- - AI-powered document extraction
-- - Collateral management for secured loans
-- - Business client information
-- - CSV/Excel import functionality
