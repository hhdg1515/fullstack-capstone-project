import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { giftListResponse } from '../../api/gifts';

function MainPage() {
    const [gifts, setGifts] = useState([]);
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let active = true;
        setLoading(true); setError('');
        apiRequest('/api/gifts', { validate: giftListResponse }).then(data => {
            if (active) setGifts(data);
        }).catch(failure => { if (active) setError(failure.message); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [attempt]);

    const goToDetailsPage = (productId) => {
        navigate(`/app/product/${productId}`);
    };

    const formatDate = (timestamp) => {
        const date = new Date(timestamp * 1000);
        return date.toLocaleString('default', { month: 'long', day: 'numeric', year: 'numeric' });
    };

    const getConditionClass = (condition) => {
        return condition === "New" ? "list-group-item-success" : "list-group-item-warning";
    };

    return (
        <main className="container mt-5">
            <h1>Demo gift collection</h1>
            <p><Link to="/app/items">Find community listings</Link> or browse the original collection below.</p>
            {loading && <p role="status">Loading gifts…</p>}
            {error && <div role="alert"><p>{error}</p><button className="btn btn-outline-secondary" onClick={() => setAttempt(value => value + 1)}>Retry gifts</button></div>}
            {!loading && !error && !gifts.length && <p>No gifts are available yet.</p>}
            <div className="row" aria-busy={loading}>
                {!loading && !error && gifts.map((gift) => (
                    <div key={gift.id} className="col-md-4 mb-4">
                        <div className="card product-card">
                            <div className="image-placeholder">
                                {gift.image ? (
                                    <img src={gift.image} alt={gift.name} />
                                ) : (
                                    <div className="no-image-available">No Image Available</div>
                                )}
                            </div>
                            <div className="card-body">
                                <h5 className="card-title">{gift.name}</h5>
                                <p className={`card-text ${getConditionClass(gift.condition)}`}>
                                    {gift.condition}
                                </p>
                                <p className="card-text date-added">
                                    {formatDate(gift.date_added)}
                                </p>
                            </div>
                            <div className="card-footer">
                                <button onClick={() => goToDetailsPage(gift.id)} className="btn btn-primary w-100">
                                    View Details
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </main>
    );
}

export default MainPage;
