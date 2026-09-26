import { apiService } from '../src/temporal/services/apiService';
import { callRobotPlanActivity, callRobotInstanceActActivity, callRobotPlanActActivity } from '../src/temporal/activities/robotActivities';

jest.mock('../src/temporal/services/apiService', () => ({
  apiService: { post: jest.fn() },
}));

const post = apiService.post as jest.Mock;

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ success: true, data: { instance_plan_id: 'plan-1' } });
});

it('passes structured selection to initial planning, never concatenates it into context', async () => {
  await callRobotPlanActivity({
    site_id: 'site-a', instance_id: 'instance-a', activity: 'robot', message: 'write', context: 'normal user context',
    skill_mode: 'required', skill_slugs: ['writer'],
  });
  expect(post).toHaveBeenCalledWith('/api/agents/growth/robot/plan', expect.objectContaining({
    skill_mode: 'required', skill_slugs: ['writer'], context: 'normal user context',
  }));
});

it('passes selection into prompting and subsequent execution cycles', async () => {
  await callRobotInstanceActActivity({
    site_id: 'site-a', instance_id: 'instance-a', message: 'continue', step_status: 'pending',
    skill_mode: 'required', skill_slugs: ['writer'],
  });
  expect(post).toHaveBeenCalledWith('/api/robots/instance/act', expect.objectContaining({
    skill_mode: 'required', skill_slugs: ['writer'],
  }));
  await callRobotPlanActActivity({
    site_id: 'site-a', instance_id: 'instance-a', activity: 'robot',
    skill_mode: 'required', skill_slugs: ['writer'],
  });
  expect(post).toHaveBeenCalledWith('/api/robots/plan/act', expect.objectContaining({
    skill_mode: 'required', skill_slugs: ['writer'],
  }));
});