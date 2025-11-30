import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest } from '../middleware/validation';
import { UserRole } from '../types';
import {
  shopService,
  shopProductService,
  loanItemService,
} from '../services/shop.service';

const router = Router();

// ===== SHOP ROUTES =====

// Create shop schema
const createShopSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  contactPerson: z.string().optional(),
  commissionRate: z.number().min(0).max(100).optional(),
});

// Update shop schema
const updateShopSchema = createShopSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/**
 * @swagger
 * /api/v1/shops:
 *   post:
 *     summary: Create a new shop
 */
router.post(
  '/',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(createShopSchema),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({
          success: false,
          message: 'Organization context required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const shop = await shopService.createShop(organizationId, req.body);
      res.status(201).json({
        success: true,
        message: 'Shop created successfully',
        data: { shop },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Create shop error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/shops:
 *   get:
 *     summary: Get all shops
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({
        success: false,
        message: 'Organization context required',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
    }

    const { search, isActive, page, limit } = req.query;
    const filters = {
      search: search as string | undefined,
      isActive:
        isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    };

    const result = await shopService.getShops(organizationId, filters);
    res.json({
      success: true,
      message: 'Shops retrieved successfully',
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get shops error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/shops/{id}:
 *   get:
 *     summary: Get shop by ID
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({
        success: false,
        message: 'Organization context required',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
    }

    const shopId = req.params.id;
    if (!shopId) {
      return res.status(400).json({
        success: false,
        message: 'Shop ID is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const shop = await shopService.getShopById(organizationId, shopId);
    if (!shop) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Shop retrieved successfully',
      data: { shop },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get shop error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/shops/{id}/stats:
 *   get:
 *     summary: Get shop statistics
 */
router.get('/:id/stats', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({
        success: false,
        message: 'Organization context required',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
    }

    const shopId = req.params.id;
    if (!shopId) {
      return res.status(400).json({
        success: false,
        message: 'Shop ID is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const stats = await shopService.getShopStats(organizationId, shopId);
    if (!stats) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Shop statistics retrieved successfully',
      data: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get shop stats error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/shops/{id}:
 *   put:
 *     summary: Update shop
 */
router.put(
  '/:id',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(updateShopSchema),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({
          success: false,
          message: 'Organization context required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const shopId = req.params.id;
      if (!shopId) {
        return res.status(400).json({
          success: false,
          message: 'Shop ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const shop = await shopService.updateShop(
        organizationId,
        shopId,
        req.body
      );
      if (!shop) {
        return res.status(404).json({
          success: false,
          message: 'Shop not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Shop updated successfully',
        data: { shop },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Update shop error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/shops/{id}:
 *   delete:
 *     summary: Delete shop (soft delete)
 */
router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({
          success: false,
          message: 'Organization context required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const shopId = req.params.id;
      if (!shopId) {
        return res.status(400).json({
          success: false,
          message: 'Shop ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const deleted = await shopService.deleteShop(organizationId, shopId);
      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'Shop not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(204).send();
    } catch (error: any) {
      console.error('Delete shop error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ===== SHOP PRODUCT ROUTES =====

// Create product schema
const createProductSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  sku: z.string().optional(),
  category: z.string().optional(),
  unitPrice: z.number().positive(),
  quantity: z.number().int().min(0).optional(),
  minimumQuantity: z.number().int().min(0).optional(),
  imageUrl: z.string().url().optional(),
});

// Update product schema
const updateProductSchema = createProductSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// Stock adjustment schema
const stockAdjustmentSchema = z.object({
  adjustment: z.number().int(),
  type: z.enum(['add', 'subtract', 'set']),
});

/**
 * @swagger
 * /api/v1/shops/{shopId}/products:
 *   post:
 *     summary: Create product for shop
 */
router.post(
  '/:shopId/products',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(createProductSchema),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({
          success: false,
          message: 'Organization context required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const shopId = req.params.shopId;
      if (!shopId) {
        return res.status(400).json({
          success: false,
          message: 'Shop ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const product = await shopProductService.createProduct(
        organizationId,
        shopId,
        req.body
      );
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Shop not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: { product },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Create product error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/shops/{shopId}/products:
 *   get:
 *     summary: Get products for shop
 */
router.get('/:shopId/products', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({
        success: false,
        message: 'Organization context required',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
    }

    const shopId = req.params.shopId;
    if (!shopId) {
      return res.status(400).json({
        success: false,
        message: 'Shop ID is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const {
      search,
      category,
      isActive,
      minPrice,
      maxPrice,
      inStock,
      page,
      limit,
    } = req.query;
    const filters = {
      search: search as string | undefined,
      category: category as string | undefined,
      isActive:
        isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      minPrice: minPrice ? parseFloat(minPrice as string) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
      inStock:
        inStock === 'true' ? true : inStock === 'false' ? false : undefined,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    };

    const result = await shopProductService.getProducts(
      organizationId,
      shopId,
      filters
    );
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Products retrieved successfully',
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/shops/{shopId}/categories:
 *   get:
 *     summary: Get product categories for shop
 */
router.get('/:shopId/categories', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({
        success: false,
        message: 'Organization context required',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
    }

    const shopId = req.params.shopId;
    if (!shopId) {
      return res.status(400).json({
        success: false,
        message: 'Shop ID is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const categories = await shopProductService.getCategories(
      organizationId,
      shopId
    );
    res.json({
      success: true,
      message: 'Categories retrieved successfully',
      data: { categories },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/shops/{shopId}/low-stock:
 *   get:
 *     summary: Get low stock products for shop
 */
router.get('/:shopId/low-stock', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({
        success: false,
        message: 'Organization context required',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
    }

    const shopId = req.params.shopId;
    if (!shopId) {
      return res.status(400).json({
        success: false,
        message: 'Shop ID is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const products = await shopProductService.getLowStockProducts(
      organizationId,
      shopId
    );
    res.json({
      success: true,
      message: 'Low stock products retrieved successfully',
      data: { products },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get low stock error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/shops/{shopId}/products/{productId}:
 *   get:
 *     summary: Get product by ID
 */
router.get('/:shopId/products/:productId', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({
        success: false,
        message: 'Organization context required',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
    }

    const { shopId, productId } = req.params;
    if (!shopId || !productId) {
      return res.status(400).json({
        success: false,
        message: 'Shop ID and Product ID are required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const product = await shopProductService.getProductById(
      organizationId,
      shopId,
      productId
    );
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Product retrieved successfully',
      data: { product },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/shops/{shopId}/products/{productId}:
 *   put:
 *     summary: Update product
 */
router.put(
  '/:shopId/products/:productId',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(updateProductSchema),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({
          success: false,
          message: 'Organization context required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const { shopId, productId } = req.params;
      if (!shopId || !productId) {
        return res.status(400).json({
          success: false,
          message: 'Shop ID and Product ID are required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const product = await shopProductService.updateProduct(
        organizationId,
        shopId,
        productId,
        req.body
      );
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Product updated successfully',
        data: { product },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Update product error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/shops/{shopId}/products/{productId}/stock:
 *   post:
 *     summary: Adjust product stock
 */
router.post(
  '/:shopId/products/:productId/stock',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(stockAdjustmentSchema),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({
          success: false,
          message: 'Organization context required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const { shopId, productId } = req.params;
      if (!shopId || !productId) {
        return res.status(400).json({
          success: false,
          message: 'Shop ID and Product ID are required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const product = await shopProductService.adjustStock(
        organizationId,
        shopId,
        productId,
        req.body.adjustment,
        req.body.type
      );
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Stock adjusted successfully',
        data: { product },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Adjust stock error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/shops/{shopId}/products/{productId}:
 *   delete:
 *     summary: Delete product (soft delete)
 */
router.delete(
  '/:shopId/products/:productId',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({
          success: false,
          message: 'Organization context required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const { shopId, productId } = req.params;
      if (!shopId || !productId) {
        return res.status(400).json({
          success: false,
          message: 'Shop ID and Product ID are required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const deleted = await shopProductService.deleteProduct(
        organizationId,
        shopId,
        productId
      );
      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'Product not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(204).send();
    } catch (error: any) {
      console.error('Delete product error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

export default router;
