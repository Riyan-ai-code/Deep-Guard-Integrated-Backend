const axios = require('axios');

// Helper to get headers with token
const getGithubHeaders = () => {
    const token = process.env.GITHUB_TOKEN;
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
};

exports.getRepoStats = async (req, res) => {
    const { owner, repo } = req.query;

    if (!owner || !repo) {
        return res.status(400).json({ error: 'Owner and repo are required' });
    }

    try {
        const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: getGithubHeaders()
        });
        res.status(200).json(response.data);
    } catch (error) {
        console.error(`GitHub API Error (Repo: ${owner}/${repo}):`, error.response?.status, error.message);
        if (error.response?.status === 404) return res.status(404).json({ error: 'Repository not found' });
        if (error.response?.status === 403) return res.status(403).json({ error: 'GitHub API Rate limit exceeded' });

        res.status(500).json({ error: 'Failed to fetch repository data' });
    }
};

exports.getContributors = async (req, res) => {
    // We ignore the specific repo param and fetch from all three
    const { owner } = req.query;
    // Default to the known owner if not provided, or use query param
    const targetOwner = owner || 'Riyan-ai-code';
    const repos = ['Deep-Guard-Frontend', 'Deep-Guard-Backend', 'Deep-Guard-ML-Engine'];

    try {
        // Fetch all in parallel
        const requests = repos.map(repo =>
            axios.get(`https://api.github.com/repos/${targetOwner}/${repo}/contributors?per_page=100`, {
                headers: getGithubHeaders()
            }).catch(err => {
                console.error(`Failed to fetch contributors for ${repo}:`, err.message);
                return { data: [] }; // Return empty on failure to not break everything
            })
        );

        const results = await Promise.all(requests);

        // Aggregate results
        const contributorMap = new Map();

        results.forEach(result => {
            const data = result.data || [];
            data.forEach(user => {
                const existing = contributorMap.get(user.login);
                if (existing) {
                    existing.contributions += user.contributions;
                } else {
                    contributorMap.set(user.login, {
                        ...user, // Keep user details (avatar, url, etc)
                        contributions: user.contributions
                    });
                }
            });
        });

        // Convert back to array and sort
        const aggregatedContributors = Array.from(contributorMap.values())
            .sort((a, b) => b.contributions - a.contributions);

        res.status(200).json(aggregatedContributors);
    } catch (error) {
        console.error(`GitHub API Error (Aggregation):`, error.message);
        res.status(500).json({ error: 'Failed to fetch aggregated contributors' });
    }
};

exports.getPulls = async (req, res) => {
    const { owner, repo } = req.query;

    if (!owner || !repo) {
        return res.status(400).json({ error: 'Owner and repo are required' });
    }

    try {
        const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=5`, {
            headers: getGithubHeaders()
        });
        res.status(200).json(response.data);
    } catch (error) {
        console.error(`GitHub API Error (Pulls: ${owner}/${repo}):`, error.message);
        res.status(500).json({ error: 'Failed to fetch pull requests' });
    }
};
