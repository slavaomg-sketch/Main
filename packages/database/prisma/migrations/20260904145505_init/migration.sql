-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateEnum
CREATE TYPE "CompatibilityStatus" AS ENUM ('VERIFIED', 'COMPATIBLE', 'COMPATIBLE_WITH_LIMITATIONS', 'UNKNOWN', 'INCOMPATIBLE');

-- CreateEnum
CREATE TYPE "CompatibilitySource" AS ENUM ('EXPLICIT', 'RULE', 'IMPORT', 'MANUFACTURER', 'ADMIN_OVERRIDE');

-- CreateEnum
CREATE TYPE "CompatibilityRuleType" AS ENUM ('CONNECTOR_MATCH', 'POWER_DELIVERY', 'WIRELESS_CHARGING', 'CONSUMABLE_MATCH', 'FIT_MODEL_LIST', 'DISPLAY_OUTPUT', 'DATA_TRANSFER', 'BAND_SIZE', 'PHYSICAL_FIT', 'PLATFORM_MATCH', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CompatibilityEvidenceType" AS ENUM ('MANUFACTURER_DOC', 'SPEC_MATCH', 'ADMIN_CONFIRMED', 'CUSTOMER_REPORT', 'IMPORT_SOURCE', 'LAB_TEST');

-- CreateEnum
CREATE TYPE "CompatibilityConstraintKind" AS ENUM ('REQUIRES_ADAPTER', 'REDUCED_POWER', 'ONLY_VARIANT', 'REGION_SPECIFIC', 'REQUIRES_PRODUCT', 'NO_DATA_TRANSFER', 'NO_VIDEO_OUTPUT', 'OTHER');

-- CreateEnum
CREATE TYPE "DeviceAliasKind" AS ENUM ('SYNONYM', 'TYPO', 'TRANSLIT', 'SHORT', 'MARKETING');

-- CreateEnum
CREATE TYPE "DeviceIdentifierType" AS ENUM ('MODEL_NUMBER', 'PART_NUMBER', 'EAN', 'MARKETING_CODE', 'ORDER_CODE');

-- CreateEnum
CREATE TYPE "SpecSource" AS ENUM ('MANUFACTURER', 'ADMIN', 'IMPORT', 'DEMO');

-- CreateEnum
CREATE TYPE "AttributeType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'ENUM', 'LIST', 'JSON');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MediaSource" AS ENUM ('UPLOAD', 'IMPORT', 'SEED', 'EXTERNAL_URL');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PAID', 'PROCESSING', 'READY_FOR_SHIPMENT', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'LABEL_CREATED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('SYSTEM', 'ADMIN', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ExternalSourceType" AS ENUM ('CSV', 'XLSX', 'YML', 'WILDBERRIES', 'OZON', 'YANDEX_MARKET', 'API');

-- CreateEnum
CREATE TYPE "ExternalListingStatus" AS ENUM ('NEW', 'LINKED', 'UPDATED', 'ERROR', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FieldOwner" AS ENUM ('MANUAL', 'SOURCE');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('UPLOADED', 'ANALYZED', 'MAPPED', 'VALIDATED', 'DRY_RUN_COMPLETE', 'APPLYING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('PENDING', 'CREATE', 'UPDATE', 'SKIP', 'CONFLICT', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportIssueLevel" AS ENUM ('ERROR', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "PromotionScope" AS ENUM ('ALL', 'CATEGORY', 'PRODUCT', 'BRAND', 'BUNDLE');

-- CreateEnum
CREATE TYPE "BannerPlacement" AS ENUM ('HOME_HERO', 'HOME_PROMO', 'HOME_WIDE', 'CATALOG_TOP', 'DEVICE_PAGE');

-- CreateEnum
CREATE TYPE "BannerTheme" AS ENUM ('LIGHT', 'DARK', 'BLUE', 'GREEN', 'ORANGE', 'MINT');

-- CreateEnum
CREATE TYPE "CollectionType" AS ENUM ('MANUAL', 'FEATURED', 'NEW', 'SALE');

-- CreateEnum
CREATE TYPE "SearchScope" AS ENUM ('DEVICE', 'PRODUCT', 'GLOBAL');

-- CreateTable
CREATE TABLE "DeviceCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "namePlural" TEXT,
    "icon" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceBrand" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "website" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceFamily" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DeviceFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceModel" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "familyId" TEXT,
    "generation" TEXT,
    "releaseYear" INTEGER,
    "primaryModelNumber" TEXT,
    "description" TEXT,
    "imageAssetId" TEXT,
    "imageUrl" TEXT,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "specsAreDemo" BOOLEAN NOT NULL DEFAULT false,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceVariant" (
    "id" TEXT NOT NULL,
    "deviceModelId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "storage" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAlias" (
    "id" TEXT NOT NULL,
    "deviceModelId" TEXT NOT NULL,
    "variantId" TEXT,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "kind" "DeviceAliasKind" NOT NULL DEFAULT 'SYNONYM',
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceIdentifier" (
    "id" TEXT NOT NULL,
    "deviceModelId" TEXT NOT NULL,
    "variantId" TEXT,
    "type" "DeviceIdentifierType" NOT NULL,
    "value" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "region" TEXT,
    "note" TEXT,

    CONSTRAINT "DeviceIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceSpecification" (
    "id" TEXT NOT NULL,
    "deviceModelId" TEXT NOT NULL,
    "variantId" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "unit" TEXT,
    "source" "SpecSource" NOT NULL DEFAULT 'ADMIN',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceSpecification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessoryCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "icon" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessoryCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBrand" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "logoAssetId" TEXT,
    "website" TEXT,
    "description" TEXT,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributeDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AttributeType" NOT NULL DEFAULT 'STRING',
    "unit" TEXT,
    "options" JSONB,
    "group" TEXT,
    "isCompatibilityRelevant" BOOLEAN NOT NULL DEFAULT false,
    "isFilterable" BOOLEAN NOT NULL DEFAULT false,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandId" TEXT,
    "categoryId" TEXT NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "shortDescription" TEXT,
    "description" TEXT,
    "baseSku" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "badges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "packageContents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warrantyMonths" INTEGER NOT NULL DEFAULT 12,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "searchText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "optionValues" JSONB NOT NULL DEFAULT '{}',
    "gtin" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "weightGrams" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "originalUrl" TEXT,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "variants" JSONB NOT NULL DEFAULT '{}',
    "source" "MediaSource" NOT NULL DEFAULT 'UPLOAD',
    "license" TEXT,
    "attribution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "assetId" TEXT NOT NULL,
    "alt" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAttribute" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "attributeId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "scopeKey" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ProductAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Price" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "priceList" TEXT NOT NULL DEFAULT 'retail',
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "amountMinor" INTEGER NOT NULL,
    "compareAtMinor" INTEGER,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "orderId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerId" TEXT,
    "authorName" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompatibilityRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ruleType" "CompatibilityRuleType" NOT NULL,
    "accessoryCategoryId" TEXT,
    "deviceCategoryId" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompatibilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompatibilityRelation" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "deviceModelId" TEXT NOT NULL,
    "deviceVariantId" TEXT,
    "scopeKey" TEXT NOT NULL DEFAULT '*:*',
    "status" "CompatibilityStatus" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" "CompatibilitySource" NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "limitations" JSONB NOT NULL DEFAULT '[]',
    "rulesApplied" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "explanation" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompatibilityRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompatibilityEvidence" (
    "id" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "type" "CompatibilityEvidenceType" NOT NULL,
    "url" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompatibilityEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompatibilityConstraint" (
    "id" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "kind" "CompatibilityConstraintKind" NOT NULL,
    "description" TEXT NOT NULL,
    "requiredProductId" TEXT,
    "params" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "CompatibilityConstraint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompatibilityOverride" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "deviceModelId" TEXT NOT NULL,
    "deviceVariantId" TEXT,
    "scopeKey" TEXT NOT NULL DEFAULT '*',
    "status" "CompatibilityStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "adminId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompatibilityOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompatibilityCheckLog" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "deviceModelId" TEXT NOT NULL,
    "deviceVariantId" TEXT,
    "status" "CompatibilityStatus" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" "CompatibilitySource" NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "rulesApplied" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompatibilityCheckLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchQueryLog" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "scope" "SearchScope" NOT NULL DEFAULT 'DEVICE',
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "matchedDeviceModelId" TEXT,
    "sessionKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchQueryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalSource" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ExternalSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalListing" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "offerId" TEXT,
    "sku" TEXT,
    "gtin" TEXT,
    "externalUrl" TEXT,
    "rawPayload" JSONB NOT NULL,
    "status" "ExternalListingStatus" NOT NULL DEFAULT 'NEW',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "productId" TEXT,
    "variantId" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalFieldOwnership" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "scopeKey" TEXT NOT NULL DEFAULT '',
    "field" TEXT NOT NULL,
    "owner" "FieldOwner" NOT NULL,
    "sourceId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalFieldOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "type" "ExternalSourceType" NOT NULL,
    "fileName" TEXT,
    "storageKey" TEXT,
    "fileHash" TEXT,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'UPLOADED',
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "options" JSONB NOT NULL DEFAULT '{}',
    "analysis" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "action" "ImportRowAction" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "matchedProductId" TEXT,
    "matchedVariantId" TEXT,
    "diff" JSONB,
    "message" TEXT,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportIssue" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rowId" TEXT,
    "level" "ImportIssueLevel" NOT NULL,
    "code" TEXT NOT NULL,
    "field" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "jobId" TEXT,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSession" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerDevice" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "deviceModelId" TEXT NOT NULL,
    "deviceVariantId" TEXT,
    "scopeKey" TEXT NOT NULL DEFAULT '*',
    "nickname" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'RU',
    "region" TEXT,
    "city" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "building" TEXT NOT NULL,
    "apartment" TEXT,
    "postalCode" TEXT,
    "comment" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "sessionToken" TEXT,
    "status" "CartStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "couponCode" TEXT,
    "activeDeviceModelId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "addedForDeviceModelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "customerId" TEXT,
    "cartId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "shippingAddress" JSONB NOT NULL,
    "deliveryMethodCode" TEXT NOT NULL,
    "deliveryProviderCode" TEXT NOT NULL,
    "deliveryCostMinor" INTEGER NOT NULL DEFAULT 0,
    "subtotalMinor" INTEGER NOT NULL,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "couponId" TEXT,
    "couponCode" TEXT,
    "comment" TEXT,
    "managerNotes" TEXT,
    "idempotencyKey" TEXT,
    "reservationExpiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "imageUrl" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "deviceModelId" TEXT,
    "compatibilityStatus" "CompatibilityStatus",

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "confirmationUrl" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerShipmentId" TEXT,
    "trackingNumber" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "methodCode" TEXT NOT NULL,
    "costMinor" INTEGER NOT NULL DEFAULT 0,
    "estimatedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "events" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "comment" TEXT,
    "actorType" "ActorType" NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "providerRefundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Banner" (
    "id" TEXT NOT NULL,
    "placement" "BannerPlacement" NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "eyebrow" TEXT,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "imageAssetId" TEXT,
    "imageUrl" TEXT,
    "handwrittenNote" TEXT,
    "theme" "BannerTheme" NOT NULL DEFAULT 'LIGHT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "CollectionType" NOT NULL DEFAULT 'MANUAL',
    "imageAssetId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionItem" (
    "collectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CollectionItem_pkey" PRIMARY KEY ("collectionId","productId")
);

-- CreateTable
CREATE TABLE "Bundle" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageAssetId" TEXT,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "fixedPriceMinor" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleItem" (
    "bundleId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BundleItem_pkey" PRIMARY KEY ("bundleId","variantId")
);

-- CreateTable
CREATE TABLE "BundleDevice" (
    "bundleId" TEXT NOT NULL,
    "deviceModelId" TEXT NOT NULL,

    CONSTRAINT "BundleDevice_pkey" PRIMARY KEY ("bundleId","deviceModelId")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discountType" "DiscountType" NOT NULL DEFAULT 'PERCENT',
    "value" INTEGER NOT NULL,
    "scope" "PromotionScope" NOT NULL DEFAULT 'ALL',
    "categoryId" TEXT,
    "brandId" TEXT,
    "badgeLabel" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "promotionId" TEXT,
    "discountType" "DiscountType" NOT NULL DEFAULT 'PERCENT',
    "value" INTEGER NOT NULL,
    "minSubtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "maxDiscountMinor" INTEGER,
    "usageLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "perCustomerLimit" INTEGER,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponUsage" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqItem" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Общие',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FaqItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "NewsletterSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEncrypted" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "_ProductToPromotion" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProductToPromotion_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCategory_slug_key" ON "DeviceCategory"("slug");

-- CreateIndex
CREATE INDEX "DeviceCategory_sortOrder_idx" ON "DeviceCategory"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceBrand_slug_key" ON "DeviceBrand"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceFamily_slug_key" ON "DeviceFamily"("slug");

-- CreateIndex
CREATE INDEX "DeviceFamily_brandId_idx" ON "DeviceFamily"("brandId");

-- CreateIndex
CREATE INDEX "DeviceFamily_categoryId_idx" ON "DeviceFamily"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceModel_slug_key" ON "DeviceModel"("slug");

-- CreateIndex
CREATE INDEX "DeviceModel_brandId_idx" ON "DeviceModel"("brandId");

-- CreateIndex
CREATE INDEX "DeviceModel_categoryId_idx" ON "DeviceModel"("categoryId");

-- CreateIndex
CREATE INDEX "DeviceModel_familyId_idx" ON "DeviceModel"("familyId");

-- CreateIndex
CREATE INDEX "DeviceModel_popularity_idx" ON "DeviceModel"("popularity");

-- CreateIndex
CREATE INDEX "DeviceModel_name_idx" ON "DeviceModel"("name");

-- CreateIndex
CREATE INDEX "DeviceVariant_deviceModelId_idx" ON "DeviceVariant"("deviceModelId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceVariant_deviceModelId_slug_key" ON "DeviceVariant"("deviceModelId", "slug");

-- CreateIndex
CREATE INDEX "DeviceAlias_normalized_idx" ON "DeviceAlias"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAlias_deviceModelId_normalized_key" ON "DeviceAlias"("deviceModelId", "normalized");

-- CreateIndex
CREATE INDEX "DeviceIdentifier_normalized_idx" ON "DeviceIdentifier"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceIdentifier_type_normalized_deviceModelId_key" ON "DeviceIdentifier"("type", "normalized", "deviceModelId");

-- CreateIndex
CREATE INDEX "DeviceSpecification_deviceModelId_key_idx" ON "DeviceSpecification"("deviceModelId", "key");

-- CreateIndex
CREATE INDEX "DeviceSpecification_variantId_idx" ON "DeviceSpecification"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessoryCategory_slug_key" ON "AccessoryCategory"("slug");

-- CreateIndex
CREATE INDEX "AccessoryCategory_parentId_idx" ON "AccessoryCategory"("parentId");

-- CreateIndex
CREATE INDEX "AccessoryCategory_sortOrder_idx" ON "AccessoryCategory"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBrand_slug_key" ON "ProductBrand"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "AttributeDefinition_code_key" ON "AttributeDefinition"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE INDEX "Product_popularity_idx" ON "Product"("popularity");

-- CreateIndex
CREATE INDEX "Product_isFeatured_idx" ON "Product"("isFeatured");

-- CreateIndex
CREATE INDEX "Product_isNew_idx" ON "Product"("isNew");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE INDEX "ProductVariant_gtin_idx" ON "ProductVariant"("gtin");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_sha256_key" ON "MediaAsset"("sha256");

-- CreateIndex
CREATE INDEX "ProductImage_productId_sortOrder_idx" ON "ProductImage"("productId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductAttribute_attributeId_idx" ON "ProductAttribute"("attributeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAttribute_productId_attributeId_scopeKey_key" ON "ProductAttribute"("productId", "attributeId", "scopeKey");

-- CreateIndex
CREATE INDEX "Price_variantId_priceList_validFrom_idx" ON "Price"("variantId", "priceList", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_variantId_warehouseId_key" ON "Inventory"("variantId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockReservation_status_expiresAt_idx" ON "StockReservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "StockReservation_orderId_idx" ON "StockReservation"("orderId");

-- CreateIndex
CREATE INDEX "Review_productId_isApproved_idx" ON "Review"("productId", "isApproved");

-- CreateIndex
CREATE UNIQUE INDEX "CompatibilityRule_code_key" ON "CompatibilityRule"("code");

-- CreateIndex
CREATE INDEX "CompatibilityRule_ruleType_isActive_idx" ON "CompatibilityRule"("ruleType", "isActive");

-- CreateIndex
CREATE INDEX "CompatibilityRelation_deviceModelId_status_idx" ON "CompatibilityRelation"("deviceModelId", "status");

-- CreateIndex
CREATE INDEX "CompatibilityRelation_productId_status_idx" ON "CompatibilityRelation"("productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompatibilityRelation_productId_deviceModelId_scopeKey_key" ON "CompatibilityRelation"("productId", "deviceModelId", "scopeKey");

-- CreateIndex
CREATE INDEX "CompatibilityEvidence_relationId_idx" ON "CompatibilityEvidence"("relationId");

-- CreateIndex
CREATE INDEX "CompatibilityConstraint_relationId_idx" ON "CompatibilityConstraint"("relationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompatibilityOverride_productId_deviceModelId_scopeKey_key" ON "CompatibilityOverride"("productId", "deviceModelId", "scopeKey");

-- CreateIndex
CREATE INDEX "CompatibilityCheckLog_createdAt_idx" ON "CompatibilityCheckLog"("createdAt");

-- CreateIndex
CREATE INDEX "CompatibilityCheckLog_productId_deviceModelId_idx" ON "CompatibilityCheckLog"("productId", "deviceModelId");

-- CreateIndex
CREATE INDEX "SearchQueryLog_normalized_idx" ON "SearchQueryLog"("normalized");

-- CreateIndex
CREATE INDEX "SearchQueryLog_createdAt_idx" ON "SearchQueryLog"("createdAt");

-- CreateIndex
CREATE INDEX "SearchQueryLog_resultCount_idx" ON "SearchQueryLog"("resultCount");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSource_code_key" ON "ExternalSource"("code");

-- CreateIndex
CREATE INDEX "ExternalListing_sku_idx" ON "ExternalListing"("sku");

-- CreateIndex
CREATE INDEX "ExternalListing_productId_idx" ON "ExternalListing"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalListing_sourceId_externalId_key" ON "ExternalListing"("sourceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalFieldOwnership_productId_scopeKey_field_key" ON "ExternalFieldOwnership"("productId", "scopeKey", "field");

-- CreateIndex
CREATE INDEX "ImportJob_status_createdAt_idx" ON "ImportJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_fileHash_idx" ON "ImportJob"("fileHash");

-- CreateIndex
CREATE INDEX "ImportRow_jobId_action_idx" ON "ImportRow"("jobId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_jobId_rowNumber_key" ON "ImportRow"("jobId", "rowNumber");

-- CreateIndex
CREATE INDEX "ImportIssue_jobId_level_idx" ON "ImportIssue"("jobId", "level");

-- CreateIndex
CREATE INDEX "SyncRun_sourceId_startedAt_idx" ON "SyncRun"("sourceId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSession_tokenHash_key" ON "CustomerSession"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerSession_customerId_idx" ON "CustomerSession"("customerId");

-- CreateIndex
CREATE INDEX "CustomerSession_expiresAt_idx" ON "CustomerSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDevice_customerId_deviceModelId_scopeKey_key" ON "CustomerDevice"("customerId", "deviceModelId", "scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_customerId_productId_key" ON "Favorite"("customerId", "productId");

-- CreateIndex
CREATE INDEX "Address_customerId_idx" ON "Address"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_sessionToken_key" ON "Cart"("sessionToken");

-- CreateIndex
CREATE INDEX "Cart_customerId_status_idx" ON "Cart"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_variantId_key" ON "CartItem"("cartId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_publicId_key" ON "Order"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_email_idx" ON "Order"("email");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_providerPaymentId_key" ON "Payment"("provider", "providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_provider_providerEventId_key" ON "PaymentEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE INDEX "Banner_placement_isActive_sortOrder_idx" ON "Banner"("placement", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_slug_key" ON "Collection"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Bundle_slug_key" ON "Bundle"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_slug_key" ON "Promotion"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CouponUsage_couponId_orderId_key" ON "CouponUsage"("couponId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPage_slug_key" ON "ContentPage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_adminId_idx" ON "AdminSession"("adminId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "_ProductToPromotion_B_index" ON "_ProductToPromotion"("B");

-- AddForeignKey
ALTER TABLE "DeviceFamily" ADD CONSTRAINT "DeviceFamily_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "DeviceBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceFamily" ADD CONSTRAINT "DeviceFamily_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DeviceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceModel" ADD CONSTRAINT "DeviceModel_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "DeviceBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceModel" ADD CONSTRAINT "DeviceModel_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DeviceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceModel" ADD CONSTRAINT "DeviceModel_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "DeviceFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceModel" ADD CONSTRAINT "DeviceModel_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceVariant" ADD CONSTRAINT "DeviceVariant_deviceModelId_fkey" FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAlias" ADD CONSTRAINT "DeviceAlias_deviceModelId_fkey" FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAlias" ADD CONSTRAINT "DeviceAlias_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "DeviceVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceIdentifier" ADD CONSTRAINT "DeviceIdentifier_deviceModelId_fkey" FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceIdentifier" ADD CONSTRAINT "DeviceIdentifier_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "DeviceVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceSpecification" ADD CONSTRAINT "DeviceSpecification_deviceModelId_fkey" FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceSpecification" ADD CONSTRAINT "DeviceSpecification_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "DeviceVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessoryCategory" ADD CONSTRAINT "AccessoryCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AccessoryCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBrand" ADD CONSTRAINT "ProductBrand_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "ProductBrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AccessoryCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttribute" ADD CONSTRAINT "ProductAttribute_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttribute" ADD CONSTRAINT "ProductAttribute_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttribute" ADD CONSTRAINT "ProductAttribute_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "AttributeDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityRule" ADD CONSTRAINT "CompatibilityRule_accessoryCategoryId_fkey" FOREIGN KEY ("accessoryCategoryId") REFERENCES "AccessoryCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityRule" ADD CONSTRAINT "CompatibilityRule_deviceCategoryId_fkey" FOREIGN KEY ("deviceCategoryId") REFERENCES "DeviceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityRelation" ADD CONSTRAINT "CompatibilityRelation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityRelation" ADD CONSTRAINT "CompatibilityRelation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityRelation" ADD CONSTRAINT "CompatibilityRelation_deviceModelId_fkey" FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityRelation" ADD CONSTRAINT "CompatibilityRelation_deviceVariantId_fkey" FOREIGN KEY ("deviceVariantId") REFERENCES "DeviceVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityRelation" ADD CONSTRAINT "CompatibilityRelation_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityEvidence" ADD CONSTRAINT "CompatibilityEvidence_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "CompatibilityRelation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityEvidence" ADD CONSTRAINT "CompatibilityEvidence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityConstraint" ADD CONSTRAINT "CompatibilityConstraint_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "CompatibilityRelation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityConstraint" ADD CONSTRAINT "CompatibilityConstraint_requiredProductId_fkey" FOREIGN KEY ("requiredProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityOverride" ADD CONSTRAINT "CompatibilityOverride_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityOverride" ADD CONSTRAINT "CompatibilityOverride_deviceModelId_fkey" FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityOverride" ADD CONSTRAINT "CompatibilityOverride_deviceVariantId_fkey" FOREIGN KEY ("deviceVariantId") REFERENCES "DeviceVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityOverride" ADD CONSTRAINT "CompatibilityOverride_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityCheckLog" ADD CONSTRAINT "CompatibilityCheckLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityCheckLog" ADD CONSTRAINT "CompatibilityCheckLog_deviceModelId_fkey" FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompatibilityCheckLog" ADD CONSTRAINT "CompatibilityCheckLog_deviceVariantId_fkey" FOREIGN KEY ("deviceVariantId") REFERENCES "DeviceVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchQueryLog" ADD CONSTRAINT "SearchQueryLog_matchedDeviceModelId_fkey" FOREIGN KEY ("matchedDeviceModelId") REFERENCES "DeviceModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalListing" ADD CONSTRAINT "ExternalListing_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ExternalSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalListing" ADD CONSTRAINT "ExternalListing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalListing" ADD CONSTRAINT "ExternalListing_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalFieldOwnership" ADD CONSTRAINT "ExternalFieldOwnership_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalFieldOwnership" ADD CONSTRAINT "ExternalFieldOwnership_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalFieldOwnership" ADD CONSTRAINT "ExternalFieldOwnership_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ExternalSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ExternalSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_matchedVariantId_fkey" FOREIGN KEY ("matchedVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportIssue" ADD CONSTRAINT "ImportIssue_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportIssue" ADD CONSTRAINT "ImportIssue_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "ImportRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ExternalSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDevice" ADD CONSTRAINT "CustomerDevice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDevice" ADD CONSTRAINT "CustomerDevice_deviceModelId_fkey" FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDevice" ADD CONSTRAINT "CustomerDevice_deviceVariantId_fkey" FOREIGN KEY ("deviceVariantId") REFERENCES "DeviceVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_activeDeviceModelId_fkey" FOREIGN KEY ("activeDeviceModelId") REFERENCES "DeviceModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_addedForDeviceModelId_fkey" FOREIGN KEY ("addedForDeviceModelId") REFERENCES "DeviceModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_deviceModelId_fkey" FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bundle" ADD CONSTRAINT "Bundle_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleItem" ADD CONSTRAINT "BundleItem_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleItem" ADD CONSTRAINT "BundleItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleDevice" ADD CONSTRAINT "BundleDevice_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleDevice" ADD CONSTRAINT "BundleDevice_deviceModelId_fkey" FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AccessoryCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "ProductBrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductToPromotion" ADD CONSTRAINT "_ProductToPromotion_A_fkey" FOREIGN KEY ("A") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductToPromotion" ADD CONSTRAINT "_ProductToPromotion_B_fkey" FOREIGN KEY ("B") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
