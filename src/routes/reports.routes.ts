import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Reports endpoint',
    data: [],
    timestamp: new Date().toISOString(),
  });
});

export default router;
