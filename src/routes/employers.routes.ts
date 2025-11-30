import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Employers endpoint',
    data: [],
    timestamp: new Date().toISOString(),
  });
});

export default router;
