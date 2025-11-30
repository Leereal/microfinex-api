import { Router } from 'express';

const router = Router();

// Placeholder routes - will be implemented later
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Users endpoint',
    data: [],
    timestamp: new Date().toISOString(),
  });
});

export default router;
