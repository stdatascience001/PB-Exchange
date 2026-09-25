import { Router } from 'express';
import { PayrollController } from './payroll.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/staff-attendance', PayrollController.staffAttendance);
router.get('/attendance', PayrollController.getAttendance);
router.post('/attendance', PayrollController.createAttendance);
router.patch('/attendance/:id', PayrollController.updateAttendanceRow);
router.post('/salary', PayrollController.createSalary);
router.get('/salary-register', PayrollController.salaryRegister);
router.post('/salary-register/pay', PayrollController.processSalaryPayment);
router.get('/leaves', PayrollController.listLeaves);
router.post('/leaves', PayrollController.createLeave);
router.patch('/leaves/:id', PayrollController.updateLeave);
router.delete('/leaves/:id', PayrollController.deleteLeave);

export const payrollRoutes = router;
